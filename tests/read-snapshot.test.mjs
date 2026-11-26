import test from 'node:test';
import assert from 'node:assert/strict';
import {readSnapshot} from '../server/read-snapshot.mjs';
import worker from '../server/api.mjs';
function fixture(){
 const manifest={version:'test',generatedAt:'2026-11-18T00:00:00Z',coverage:{minDate:'2026-11-01',maxDate:'2026-11-03',updatedAt:'2026-11-18T00:00:00Z'},pvzs:['A'],provinces:['P'],districts:['D'],revisions:{dispatch:7},history:[],idBlocks:[[{key:'ids/0/0',max:'ID-0204'}]]};
 const daily=[['2026-11-01',2,200],['2026-11-03',5,500]],scope={daily,clients:[['2026-11-01','legal',2],['2026-11-03','legal',5]],payments:[['2026-11-01','corporate',2,200],['2026-11-03','corporate',5,500]],routes:[['2026-11-01',0,0,2],['2026-11-03',0,0,5]]};
 const map=new Map(Object.entries({current:{valid:true,version:'test'},'v/test/manifest':manifest,'v/test/scope/0':scope,'v/test/scope/1':scope,'v/test/districts/0':[['2026-11-03',0,0,5]],'v/test/root':{daily:daily.map(r=>({source_kind:'dispatch',business_date:r[0],pvz:'A',record_count:r[1],fee_minor:r[2],cod_minor:0})),coverage:manifest.coverage,lastUpload:manifest.coverage.updatedAt},'v/test/ids/0/0':Array.from({length:205},(_,i)=>['ID-'+String(i).padStart(4,'0'),'2026-11-03',0,0])}));
 return {map,kv:{async get(key,type){const v=map.get(key);return v===undefined?null:type==='json'?v:JSON.stringify(v);},async put(key,value){map.set(key,JSON.parse(value));}}};
}
test('snapshot computes filtered totals, comparisons and scoped IDs without D1',async()=>{
 const {kv}=fixture(),get=path=>readSnapshot(kv,new URL('https://example.test'+path));
 const all=await get('/api/dispatch');assert.equal(all.total.count,7);assert.equal(all.total.amount,700);assert.equal(all.clients[0].count,7);
 const day=await get('/api/dispatch?period=day&anchor=2026-11-03');assert.equal(day.period.previousFrom,'2026-11-01');assert.equal(day.growth.count.delta,3);
 const comparison=await get('/api/dispatch/compare?fromA=2026-11-01&toA=2026-11-03&fromB=2026-11-01&toB=2026-11-01');assert.equal(comparison.A.count,7);assert.equal(comparison.B.count,2);
 const first=await get('/api/dispatch/ids?from=2026-11-03&to=2026-11-03&province=P&pvz=A');assert.equal(first.ids.length,200);assert.equal(first.nextCursor,'ID-0199');
 const next=await get('/api/dispatch/ids?from=2026-11-03&to=2026-11-03&province=P&pvz=A&after=ID-0199&revision=7');assert.equal(next.ids.length,5);
 await assert.rejects(()=>get('/api/dispatch/ids?from=2026-11-03&to=2026-11-03&province=P&revision=6'),/invalid_data_changed/);
 await assert.rejects(()=>get('/api/dispatch/ids?from=2026-11-03&to=2026-11-03'),/invalid_filter/);
});
test('API serves recovery read models even when every database read fails',async()=>{
 const {kv}=fixture(),DB=new Proxy({},{get(){throw Error('D1 must not be called');}}),env={DB,REPORT_CACHE:kv,UPLOAD_RATE_LIMITER:{async limit(){return {success:true};}}};
 for(const path of ['/api/dashboard','/api/history','/api/dispatch','/api/dispatch/ids?from=2026-11-03&to=2026-11-03&province=P']){
  const response=await worker.fetch(new Request('https://example.test'+path),env);assert.equal(response.status,200);
 }
});
test('invalidated snapshots are not served as fresh reports',async()=>{
 const {kv,map}=fixture();map.set('current',{valid:false});assert.equal(await readSnapshot(kv,new URL('https://example.test/api/dispatch')),null);
});
