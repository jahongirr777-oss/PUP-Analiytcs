import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ReadableStream} from 'node:stream/web';
import worker from '../server/api.mjs';
import {readCsv} from '../server/csv.mjs';

export function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['0001_import_metadata.sql','0002_live_import.sql','0003_dispatch_analytics.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const db={prepare(sql){let args=[];return {
   bind(...values){args=values;return this;},
   async first(){return sqlite.prepare(sql).get(...args)||null;},
   async all(){return {results:sqlite.prepare(sql).all(...args)};},
   async run(){return {meta:sqlite.prepare(sql).run(...args)};},
   execute(){const stmt=sqlite.prepare(sql);return stmt.columns().length?{results:stmt.all(...args)}:{results:[],meta:stmt.run(...args)};},
 };},async batch(statements){sqlite.exec('BEGIN');try{const out=statements.map(s=>s.execute());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {db,sqlite};
}
export async function run(){
 const {db,sqlite}=database();
 const env={DB:db,REPLACE_PASSWORD:'test-only',UPLOAD_RATE_LIMITER:{async limit(){return {success:true};}}};
 const call=(path,data,extra={})=>worker.fetch(new Request('https://test.local'+path,{method:data?'POST':'GET',headers:{Origin:'https://test.local','Content-Type':'application/json',...extra},...data&&{body:JSON.stringify(data)}}),env);
 const row=(id,pvz=null,fee=1234)=>({id,status:'example',sourceDate:'01-Nov-2026 12:34:56',pvz,deliveryFeeMinor:fee,codMinor:0,clientName:'MUST NOT BE STORED'});
 async function start(kind,mode,n,pw){const response=await call('/api/imports',{kind,mode,rows:n,confirmReplace:mode==='replace'},pw?{'X-Replace-Password':pw}:{});return {status:response.status,...await response.json()};}
 async function load(kind,mode,rows){const job=await start(kind,mode,rows.length,'test-only');assert.equal(job.status,201);const headers={'X-Upload-Token':job.token,'X-Replace-Password':'test-only'};
  assert.equal((await call('/api/imports/'+job.id+'/chunk',{seq:0,rows},headers)).status,200);
  assert.equal((await call('/api/imports/'+job.id+'/chunk',{seq:0,rows},headers)).status,200);
  const complete=await call('/api/imports/'+job.id+'/complete',{},headers);assert.equal(complete.status,200,await complete.clone().text());
  assert.equal((await call('/api/imports/'+job.id+'/complete',{},headers)).status,200);return job;
 }
 assert.equal((await start('dispatch','replace',1,'wrong')).status,403);
 await load('dispatch','add',[row('001'),row('002','Example')]);
 await load('delivery','add',[row('001','Other')]);
 await load('dispatch','add',[row('001','Overwrite',999),row('003')]);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM operational_records WHERE source_kind='dispatch'").get().n,3);
 assert.equal(sqlite.prepare("SELECT fee_minor FROM operational_records WHERE source_kind='dispatch' AND id='001'").get().fee_minor,1234);
 assert.equal(sqlite.prepare("SELECT pvz FROM operational_records WHERE source_kind='dispatch' AND id='001'").get().pvz,null);
 await load('dispatch','replace',[row('004','New')]);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM operational_records WHERE source_kind='dispatch'").get().n,1);
 assert.equal(sqlite.prepare("SELECT count(*) n FROM operational_records WHERE source_kind='delivery'").get().n,1);
 const snapshot=JSON.stringify(sqlite.prepare('SELECT * FROM operational_records ORDER BY source_kind,id').all());
 const broken=await start('dispatch','replace',2,'test-only'), bh={'X-Upload-Token':broken.token,'X-Replace-Password':'test-only'};
 assert.equal((await call('/api/imports/'+broken.id+'/chunk',{seq:0,rows:[row('DUP'),row('DUP')]},bh)).status,200);
 assert.equal((await call('/api/imports/'+broken.id+'/complete',{},bh)).status,409);
 assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM operational_records ORDER BY source_kind,id').all()),snapshot);
 const stale=await start('delivery','add',1),sh={'X-Upload-Token':stale.token};
 await call('/api/imports/'+stale.id+'/chunk',{seq:0,rows:[row('stale')]},sh);
 await load('delivery','add',[row('fresh')]);
 assert.equal((await call('/api/imports/'+stale.id+'/complete',{},sh)).status,409);
 assert.equal((await call('/api/imports/'+stale.id+'/cancel',{},sh)).status,200);
 assert.equal((await call('/api/imports/'+stale.id+'/chunk',{seq:1,rows:[row('bad')]},sh)).status,409);
 const dash=await (await call('/api/dashboard')).json();assert.ok(dash.lastUpload);assert.ok(!JSON.stringify(dash).includes('MUST NOT BE STORED'));
 const hist=await (await call('/api/history')).json();assert.ok(hist.items.some(h=>h.completed_at));assert.ok(!JSON.stringify(hist).includes('token_hash'));
 const forged=await worker.fetch(new Request('https://test.local/api/imports',{method:'POST',headers:{Origin:'https://elsewhere.test','Content-Type':'application/json'},body:'{}'}),env);assert.equal(forged.status,403);
 const text='\uFEFFa,b\r\n"x,y","line1\nline2"\r\n"a""b",c';const bytes=new TextEncoder().encode(text);let i=0;const stream=new ReadableStream({pull(controller){if(i===bytes.length)return controller.close();controller.enqueue(bytes.slice(i,i+1));i++;}});
 const parsed=[];for await(const r of readCsv(stream))parsed.push(r);assert.deepEqual(parsed,[['a','b'],['x,y','line1\nline2'],['a"b','c']]);
 sqlite.close();return 'Add, deduplication, replacement isolation, wrong password, replay, rollback, stale revisions, cancellation, privacy and CSV boundary tests passed';
}
