import test from 'node:test';
import assert from 'node:assert/strict';
import {periodRange,comparison} from '../server/periods.mjs';
import {createMapper} from '../server/import-mapping.mjs';
import {normalizeRecord} from '../server/record.mjs';
import {publicationStatements} from '../server/publish.mjs';
import {dispatchAnalytics} from '../server/dispatch-analytics.mjs';
import {buildSeries} from '../src/dispatch-series.mjs';
import {database} from './live-import.mjs';
test('calendar ranges compare elapsed periods and clamp leap dates',()=>{
 assert.deepEqual(periodRange('week','2026-11-17'),{from:'2026-11-16',to:'2026-11-17',previousFrom:'2026-11-09',previousTo:'2026-11-10'});
 assert.deepEqual(periodRange('month','2026-11-17'),{from:'2026-11-01',to:'2026-11-17',previousFrom:'2026-10-01',previousTo:'2026-10-17'});
 assert.equal(periodRange('year','2024-02-29').previousTo,'2023-02-28');
 assert.equal(periodRange('month','2026-04-30').previousTo,'2026-03-31');
 assert.equal(periodRange('half','2026-06-30').previousTo,'2025-12-31');
 assert.equal(periodRange('quarter','2026-06-30').previousTo,'2026-03-31');
 assert.equal(periodRange('decade','2026-11-10').previousTo,'2026-10-31');
 assert.equal(periodRange('quarter','2026-11-17').from,'2026-10-01');
 assert.equal(periodRange('half','2026-11-17').from,'2026-07-01');
 assert.equal(periodRange('decade','2026-11-17').previousTo,'2026-11-07');
 assert.equal(periodRange('custom','2026-11-17','2026-11-10','2026-11-17').previousFrom,'2026-11-02');
 assert.throws(()=>periodRange('day','2026-02-31'),/invalid_date/);
 assert.throws(()=>periodRange('custom','2026-11-17','2026-11-17','2026-11-01'),/invalid_range/);
 assert.equal(comparison(2,0,true).percent,null);
 assert.equal(comparison(2,5,true).percent,-60);
 assert.equal(comparison(10,0,false).delta,null);
});
test('new dispatch mapping classifies approved categories and strips personal fields',()=>{
 const head=['Трек ID','Услуги','Дата создания','Стоимость доставки','Статус оплаты','Первый принявший агент','Имя клиента','Тип клиента','Регион получателя'];
 const mapped=createMapper('dispatch',head)(['001','service','17-Nov-2026 12:00:00','12.34','Наличные от получателя','','PRIVATE CLIENT','Мерчант','Buxoro shahri']);
 const result=normalizeRecord({...mapped,codMinor:0});
 assert.equal(result.clientType,'legal');assert.equal(result.paymentType,'recipient_cash');assert.equal(result.recipientProvince,'Buxoro viloyati');assert.equal(result.pvz,null);assert.equal(result.id,'001');
 assert.ok(!JSON.stringify(result).includes('PRIVATE CLIENT'));
 const unknown=normalizeRecord({...mapped,codMinor:0,clientType:'unknown',recipientDistrict:'Unlisted district'});assert.equal(unknown.recipientProvince,'Аниқланмаган');
});
test('dispatch aggregates reconcile, isolate PVZ, and suppress uncovered comparisons',async()=>{
 const {db,sqlite}=database();
 try{
  sqlite.exec(`INSERT INTO upload_history(id,source_kind,mode,token_hash,base_revision,expected_rows,expires_at) VALUES('test','dispatch','replace','x',0,3,9999999999999)`);
  const source=[
   {id:'1',sourceDate:'16-Nov-2026 12:00:00',status:'',pvz:'A',deliveryFeeMinor:100,codMinor:0,clientType:'legal',paymentType:'corporate',recipientDistrict:'Buxoro shahri'},
   {id:'2',sourceDate:'17-Nov-2026 12:00:00',status:'',pvz:'A',deliveryFeeMinor:200,codMinor:0,clientType:'individual',paymentType:'sender_cash',recipientDistrict:'Keles shaxri'},
   {id:'3',sourceDate:'17-Nov-2026 12:00:00',status:'',pvz:null,deliveryFeeMinor:300,codMinor:0,clientType:'legal',paymentType:'unpaid',recipientDistrict:'Yunusobod tumani'},
  ].map(normalizeRecord);
  sqlite.prepare("INSERT INTO upload_chunks VALUES('test',0,'x',?)").run(JSON.stringify(source));
  await db.batch(publicationStatements(db,{id:'test'}));
  const all=await dispatchAnalytics(db,new URLSearchParams());assert.equal(all.total.count,3);assert.equal(all.total.amount,600);
  assert.equal(all.clients.reduce((n,r)=>n+r.count,0),3);assert.equal(all.payments.reduce((n,r)=>n+r.amount,0),600);assert.equal(all.destinations.reduce((n,r)=>n+r.count,0),3);
  const filtered=await dispatchAnalytics(db,new URLSearchParams({pvz:'A',period:'day',anchor:'2026-11-17'}));assert.equal(filtered.total.count,1);assert.equal(filtered.growth.count.delta,0);assert.equal(filtered.total.amount,200);
  const missing=await dispatchAnalytics(db,new URLSearchParams({period:'month',anchor:'2026-11-17'}));assert.equal(missing.growth.count.delta,null);
  const future=await dispatchAnalytics(db,new URLSearchParams({period:'day',anchor:'2026-11-18'}));assert.equal(future.growth.count.delta,null);
  const blank=await dispatchAnalytics(db,new URLSearchParams({pvz:''}));assert.equal(blank.total.count,1);
  const series=buildSeries(all.series,'2026-11-16','2026-11-17','day',all.coverage);assert.equal(series[0].growth.delta,null);assert.equal(series[1].growth.delta,1);
 }finally{sqlite.close();}
});
