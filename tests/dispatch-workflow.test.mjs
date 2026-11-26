import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './live-import.mjs';
import {dispatchAnalytics} from '../server/dispatch-analytics.mjs';
import {compareDispatch,dispatchIds} from '../server/dispatch-compare.mjs';
import {normalizeRecord} from '../server/record.mjs';
import {topWarehouseRoutes,warehouseLabel} from '../server/warehouse-label.mjs';
import {buildSeries} from '../src/dispatch-series.mjs';
test('zero previous day falls back to last populated earlier day in the same PVZ',async()=>{
 const {db,sqlite}=database();try{
  for(const [date,pvz,count] of [['2026-11-01','A',2],['2026-11-03','A',5],['2026-11-02','B',3]])sqlite.prepare('INSERT INTO daily_totals VALUES(?,?,?,?,?,?)').run('dispatch',date,pvz,count,count*100,0);
  const data=await dispatchAnalytics(db,new URLSearchParams({period:'day',anchor:'2026-11-03',pvz:'A'}));assert.equal(data.previous.count,2);assert.equal(data.period.previousFrom,'2026-11-01');assert.equal(data.period.fallback,true);assert.equal(data.growth.count.delta,3);
  const series=buildSeries(data.series,'2026-11-03','2026-11-03','day',data.coverage);assert.equal(series[0].previousFrom,'2026-11-01');assert.equal(series[0].growth.delta,3);
 }finally{sqlite.close();}
});
test('warehouse display aliases and one top province per warehouse',()=>{
 assert.equal(warehouseLabel("101 Fargo Sergeli bo'lim"),'101 Sergili Warehouse');assert.equal(warehouseLabel('100 TOSHKENT Sorting WAREHOUSE'),'100 Toshkent Warehouse');
 const rows=[{pvz:'A',province:'X',count:2},{pvz:'A',province:'Y',count:5},{pvz:'B',province:'Z',count:3}];assert.equal(topWarehouseRoutes(rows,true).length,2);assert.equal(topWarehouseRoutes(rows,true).find(r=>r.pvz==='A').province,'Y');assert.equal(topWarehouseRoutes(rows,false).length,3);
});
test('source-secret assignment overrides only approved dispatch clients',()=>{
 const row={id:'1',status:'',sourceDate:'17-Nov-2026 12:00:00',pvz:'Other',deliveryFeeMinor:100,codMinor:0,clientKey:'synthetic'};
 const result=normalizeRecord(row,{sourceKind:'dispatch',clientKeys:['synthetic']});assert.equal(result.pvz,"106 Fargo Bek-Baraka bo'limi");assert.equal(result.clientKey,undefined);
 assert.equal(normalizeRecord(row,{sourceKind:'delivery',clientKeys:['synthetic']}).pvz,'Other');
});
test('PVZ correction is atomic and preserves counts, money and delivery',async()=>{
 const {db,sqlite}=database();try{
  sqlite.exec("INSERT INTO operational_records VALUES('dispatch','1','2026-11-17','', 'A',100,0,'legal','corporate','Buxoro shahri','Buxoro viloyati'); INSERT INTO operational_records VALUES('delivery','1','2026-11-17','','A',300,500,'unknown','unknown','','Аниқланмаган'); INSERT INTO daily_totals VALUES('dispatch','2026-11-17','A',1,100,0); INSERT INTO daily_totals VALUES('delivery','2026-11-17','A',1,300,500); INSERT INTO dispatch_cube VALUES('2026-11-17','A','legal','corporate','Buxoro viloyati','Buxoro shahri',1,100);");
  sqlite.exec("UPDATE operational_records SET pvz='106' WHERE source_kind='dispatch' AND id='1'");
  assert.equal(sqlite.prepare("SELECT sum(record_count) n,sum(fee_minor) f FROM dispatch_cube").get().n,1);assert.equal(sqlite.prepare("SELECT pvz FROM daily_totals WHERE source_kind='dispatch'").get().pvz,'106');assert.equal(sqlite.prepare("SELECT pvz FROM operational_records WHERE source_kind='delivery'").get().pvz,'A');assert.equal(sqlite.prepare("SELECT revision FROM source_revision WHERE source_kind='dispatch'").get().revision,1);
  const a=await compareDispatch(db,new URLSearchParams({fromA:'2026-11-17',toA:'2026-11-17',fromB:'2026-11-17',toB:'2026-11-17',pvzsA:'["106"]',pvzsB:'["A"]'}));assert.equal(a.A.count,1);assert.equal(a.B.count,0);assert.equal(a.growth.count.delta,1);assert.equal(a.growth.count.percent,null);
  const ids=await dispatchIds(db,new URLSearchParams({from:'2026-11-17',to:'2026-11-17',province:'Buxoro viloyati',pvz:'106'}));assert.deepEqual(ids.ids,['1']);assert.equal(ids.revision,1);await assert.rejects(()=>dispatchIds(db,new URLSearchParams({from:'2026-11-17',to:'2026-11-17',province:'Buxoro viloyati',revision:'0'})),/invalid_data_changed/);
  await assert.rejects(()=>dispatchIds(db,new URLSearchParams({from:'2026-11-17',to:'2026-11-17'})),/invalid_filter/);
 }finally{sqlite.close();}
});
