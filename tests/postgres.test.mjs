import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createApplication,createLimiter} from '../postgres/application.mjs';
import {createPostgresAdapter,placeholders,convertResult} from '../postgres/adapter.mjs';
import {apiTarget} from '../src/api-target.mjs';
const origin='https://dashboard.test';
function row(id,pvz=null,fee=1000,extra={}){return {id,sourceDate:'01-Nov-2026 12:00:00',status:'test',pvz,deliveryFeeMinor:fee,codMinor:0,clientType:'legal',paymentType:'corporate',recipientDistrict:'Сергели',clientName:'NEVER_STORE_THIS',...extra};}
async function fixture(){
 const pg=new PGlite();await pg.exec(await readFile(new URL('../postgres/schema.sql',import.meta.url),'utf8'));
 const pool={query:(sql,args)=>pg.query(sql,args),async connect(){return {query:(sql,args)=>pg.query(sql,args),release(){}};}};
 let now=Date.now();const app=createApplication(pool,{siteOrigin:origin,password:'test-only',now:()=>now});
 async function call(path,data,headers={},otherOrigin=origin){
  return app.fetch(new Request('https://api.test'+path,{method:data?'POST':'GET',headers:{Origin:otherOrigin,'Content-Type':'application/json',...headers}}),{clientIp:'test',data});
 }
 async function start(kind,mode,rows){const response=await call('/api/imports',{kind,mode,rows,confirmReplace:mode==='replace'},{'X-Replace-Password':'test-only'});assert.equal(response.status,201,await response.clone().text());return response.json();}
 const token=job=>({'X-Upload-Token':job.token,'X-Replace-Password':'test-only'});
 async function load(kind,mode,rows){
  const job=await start(kind,mode,rows.length),headers=token(job);
  const response=await call(`/api/imports/${job.id}/chunk`,{seq:0,rows},headers);assert.equal(response.status,200,await response.clone().text());
  assert.equal((await call(`/api/imports/${job.id}/complete`,{},headers)).status,202);
  const result=await app.imports.publishNext();assert.ok(!result.failed,JSON.stringify(result));app.invalidate();
  assert.equal((await (await call(`/api/imports/${job.id}/status`,null,headers)).json()).state,'complete');return job;
 }
 return {pg,pool,app,call,start,load,token,advance:()=>{now+=20000;}};
}
test('PostgreSQL import, delta rollups, atomic replacement, revision conflicts and privacy',async()=>{
 const f=await fixture(),{pg,pool,app,call,start,load,token}=f;
 try{
  const bad=await call('/api/imports',{kind:'dispatch',mode:'replace',rows:1,confirmReplace:true},{'X-Replace-Password':'bad'});assert.equal(bad.status,403);
  const forbidden=await call('/api/imports',{kind:'dispatch',mode:'add',rows:1},{},'https://evil.test');assert.equal(forbidden.status,403);assert.equal(forbidden.headers.get('access-control-allow-origin'),null);
  const job=await load('dispatch','add',[row('001'),row('002','101 Warehouse',2000)]);
  assert.equal((await call(`/api/imports/${job.id}/status`,null,{'X-Upload-Token':'bad'})).status,404);
  await load('delivery','add',[row('001','102 Warehouse',500)]);
  await load('dispatch','add',[row('001','Wrong',99999),row('003','101 Warehouse',3000,{clientType:'individual'})]);
  let dashboard=await (await call('/api/dashboard')).json();
  assert.equal(dashboard.rows.filter(r=>r.source_kind==='dispatch').reduce((s,r)=>s+r.count,0),3);
  assert.equal(dashboard.rows.filter(r=>r.source_kind==='dispatch').reduce((s,r)=>s+r.fee_minor,0),6000);
  const report=await (await call('/api/dispatch')).json();assert.equal(report.total.count,3);assert.equal(report.total.amount,6000);assert.equal(report.clients.reduce((n,r)=>n+r.count,0),3);assert.equal(report.payments.reduce((n,r)=>n+r.amount,0),6000);assert.equal(report.destinations.reduce((n,r)=>n+r.count,0),3);assert.equal(report.coverage.minDate,'2026-11-01');
  const pvz=await (await call('/api/dispatch?pvz=101+Warehouse')).json();assert.equal(pvz.total.count,2);
  const province=report.destinations[0].province;
  const ids=await (await call('/api/dispatch/ids?'+new URLSearchParams({from:'2026-11-01',to:'2026-11-01',province}))).json();assert.deepEqual(ids.ids,['001','002','003']);
  const p=new URLSearchParams({fromA:'2026-11-01',toA:'2026-11-01',fromB:'2026-11-01',toB:'2026-11-01',pvzsA:JSON.stringify(['101 Warehouse']),pvzsB:'[]'});
  const compared=await (await call('/api/dispatch/compare?'+p)).json();assert.equal(compared.A.count,2);assert.equal(compared.B.count,3);
  const dup=await start('dispatch','replace',2),dh=token(dup);
  assert.equal((await call(`/api/imports/${dup.id}/chunk`,{seq:0,rows:[row('DUP'),row('DUP')]},dh)).status,409);
  assert.equal(Number((await pool.query('SELECT received_rows FROM upload_history WHERE id=$1',[dup.id])).rows[0].received_rows),0);
  await call(`/api/imports/${dup.id}/cancel`,{},dh);
  const staging=await start('dispatch','replace',1),sh=token(staging);
  assert.equal((await call(`/api/imports/${staging.id}/chunk`,{seq:0,rows:[row('NEW','New Warehouse',7000)]},sh)).status,200);
  assert.equal((await call(`/api/imports/${staging.id}/chunk`,{seq:0,rows:[row('NEW','New Warehouse',7000)]},sh)).status,200);
  assert.equal((await call(`/api/imports/${staging.id}/chunk`,{seq:0,rows:[row('DIFFERENT')]},sh)).status,409);
  await call(`/api/imports/${staging.id}/complete`,{},sh);
  assert.equal((await (await call('/api/dispatch')).json()).total.count,3,'old generation remains visible until publish');
  await app.imports.publishNext();app.invalidate();
  const newReport=await (await call('/api/dispatch')).json();assert.equal(newReport.total.count,1);assert.equal(newReport.total.amount,7000);
  assert.equal(Number((await pool.query("SELECT count(*) count FROM operational_records WHERE source_kind='delivery'")).rows[0].count),1);
  assert.equal((await call('/api/dispatch/ids?'+new URLSearchParams({from:'2026-11-01',to:'2026-11-01',province,revision:String(ids.revision)}))).status,400);
  const stale=await start('delivery','add',1),headers=token(stale);
  await call(`/api/imports/${stale.id}/chunk`,{seq:0,rows:[row('STALE')]},headers);
  await load('delivery','add',[row('FRESH')]);
  await call(`/api/imports/${stale.id}/complete`,{},headers);
  assert.equal((await app.imports.publishNext()).failed,true);
  assert.equal(Number((await pool.query("SELECT count(*) count FROM operational_records WHERE id='STALE'")).rows[0].count),0);
  const history=await (await call('/api/history')).json();assert.ok(history.items.some(r=>r.state==='complete'));assert.ok(!JSON.stringify(history).includes('token_hash'));
  const privateRows=await pool.query('SELECT * FROM records_store');assert.ok(!JSON.stringify(privateRows.rows,(_,v)=>typeof v==='bigint'?String(v):v).includes('NEVER_STORE_THIS'));
  await app.imports.cleanup();assert.equal(Number((await pool.query('SELECT count(*) count FROM import_records')).rows[0].count),0);
 }finally{await pg.close();}
});
test('PostgreSQL rollback preserves visible data when a late summary statement fails',async()=>{
 const f=await fixture();try{
  await f.load('dispatch','add',[row('OLD')]);
  const job=await f.start('dispatch','replace',1),headers=f.token(job);
  await f.call(`/api/imports/${job.id}/chunk`,{seq:0,rows:[row('NEW')]},headers);await f.call(`/api/imports/${job.id}/complete`,{},headers);
  await f.pg.exec('ALTER TABLE dispatch_routes_daily_store ADD CONSTRAINT fail_test CHECK(record_count<1) NOT VALID');
  const result=await f.app.imports.publishNext();assert.equal(result.failed,true);
  assert.deepEqual((await f.pool.query('SELECT id FROM operational_records')).rows,[{id:'OLD'}]);
 }finally{await f.pg.close();}
});
test('last good aggregates survive a database outage with an explicit stale timestamp; IDs never fall back',async()=>{
 const f=await fixture();try{
  await f.load('dispatch','add',[row('OLD')]);await f.call('/api/dashboard');f.advance();
  const real=f.pool.query,connect=f.pool.connect;const offline=async()=>{throw Object.assign(Error('offline'),{code:'ECONNREFUSED'});};f.pool.query=offline;f.pool.connect=offline;
  const saved=await (await f.call('/api/dashboard')).json();assert.equal(saved.readMode,'fallback');assert.ok(saved.snapshotAt);assert.equal(saved.rows[0].count,1);
  assert.equal((await f.call('/api/dispatch/ids?from=2026-11-01&to=2026-11-01&province=test')).status,503);
  f.pool.query=real;f.pool.connect=connect;
 }finally{await f.pg.close();}
});
test('parameter binding, integer safety, server destination and bounded rate limiting',async()=>{
 assert.equal(placeholders("SELECT '?' value, ? other, 'it''s ?' literal"),"SELECT '?' value, $1 other, 'it''s ?' literal");
 assert.throws(()=>convertResult({rows:[{count:'9007199254740992'}],fields:[{name:'count',dataTypeID:20}]}),/out_of_range/);
 assert.equal(apiTarget('/api/dashboard','https://api.example.com'),'https://api.example.com/api/dashboard');
 assert.equal(apiTarget('/api/dashboard'),'/api/dashboard');
 for(const base of ['http://api.example.com','https://user:pass@api.example.com','https://api.example.com?secret=x'])assert.throws(()=>apiTarget('/api/dashboard',base));
 let now=0;const rate=createLimiter({limit:2,now:()=>now});assert.equal((await rate.limit({key:'a'})).success,true);assert.equal((await rate.limit({key:'a'})).success,true);assert.equal((await rate.limit({key:'a'})).success,false);now=61000;assert.equal((await rate.limit({key:'a'})).success,true);
});
