import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createPostgresWorker} from '../postgres/worker.mjs';
import {connectionOptions} from '../postgres/connection.mjs';
test('Worker PostgreSQL entry supports the existing URL, private chunk upload and background publication',async()=>{
 const pg=new PGlite();await pg.exec(await readFile(new URL('../postgres/schema.sql',import.meta.url),'utf8'));
 const pool={query:(sql,args)=>pg.query(sql,args),async connect(){return {query:(sql,args)=>pg.query(sql,args),release(){}};},async end(){}};
 const worker=createPostgresWorker(()=>pool),pending=[];
 const env={POSTGRES_DATABASE_URL:'test-only',REPLACE_PASSWORD:'test-only',UPLOAD_RATE_LIMITER:{async limit(){return {success:true};}},ASSETS:{fetch:async()=>new Response('site')}};
 const ctx={waitUntil(promise){pending.push(promise);}};
 const call=(path,data,headers={})=>worker.fetch(new Request('https://site.test'+path,{method:data?'POST':'GET',headers:{Origin:'https://site.test','Content-Type':'application/json',...headers},...data&&{body:JSON.stringify(data)}}),env,ctx);
 try{
  assert.equal(await (await call('/')).text(),'site');
  const config=await (await call('/api/config')).json();assert.equal(config.maxRows,50000);assert.equal(config.chunkRows,100);assert.equal(config.asyncPublication,true);
  const started=await (await call('/api/imports',{kind:'dispatch',mode:'add',rows:1})).json();assert.ok(started.id);
  const headers={'X-Upload-Token':started.token};
  const row={id:'SAFE-001',sourceDate:'01-Nov-2026 12:00:00',status:'test',pvz:null,deliveryFeeMinor:100,codMinor:0,clientName:'DO_NOT_TRANSFER'};
  assert.equal((await call(`/api/imports/${started.id}/chunk`,{seq:0,rows:[row]},headers)).status,200);
  assert.equal((await call(`/api/imports/${started.id}/complete`,{},headers)).status,202);
  await Promise.all(pending.splice(0));
  const report=await (await call('/api/dispatch')).json();assert.equal(report.total.count,1);assert.equal(report.total.amount,100);
  const status=await (await call(`/api/imports/${started.id}/status`,null,headers)).json();assert.equal(status.state,'complete');
  await Promise.all(pending.splice(0));
  assert.equal((await worker.fetch(new Request('https://site.test/api/imports',{method:'POST',headers:{Origin:'https://other.test'}}),env,ctx)).status,403);
  assert.equal((await call('/api/imports',{kind:'dispatch',mode:'replace',rows:1,confirmReplace:true},{'X-Replace-Password':'bad'})).status,403);
  const history=await (await call('/api/history')).json();assert.equal(history.items[0].state,'complete');assert.ok(!JSON.stringify(history).includes(started.token));
 }finally{await pg.close();}
});
test('verified database TLS is mandatory even when a URL requests insecure TLS',()=>{
 const config=connectionOptions({POSTGRES_DATABASE_URL:'postgresql://user:example@db.example.test/db?sslmode=no-verify',POSTGRES_CA_CERT:'example-ca'});
 assert.equal(config.ssl.rejectUnauthorized,true);assert.equal(config.ssl.ca,'example-ca');assert.ok(!config.connectionString.includes('sslmode'));
 assert.throws(()=>connectionOptions({POSTGRES_DATABASE_URL:'http://user:example@db.example.test/db'}),/invalid_postgres_url/);
 assert.throws(()=>connectionOptions({HYPERDRIVE:{connectionString:'postgresql://internal'}}),/origin_tls_not_verified/);
 assert.ok(connectionOptions({HYPERDRIVE:{connectionString:'postgresql://internal'},HYPERDRIVE_TLS_VERIFIED:'true'}).connectionString);
});
