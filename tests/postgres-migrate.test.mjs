import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {database} from './live-import.mjs';
import {migrateFromSqlite} from '../postgres/migrate.mjs';
test('migration copies allowlisted records and history, verifies fingerprints and refuses a populated target',async()=>{
 const {sqlite}=database(),pg=new PGlite();
 const pool={query:(sql,args)=>pg.query(sql,args),async connect(){return {query:(sql,args)=>pg.query(sql,args),release(){}};}};
 try{
  await pg.exec(await readFile(new URL('../postgres/schema.sql',import.meta.url),'utf8'));
  sqlite.exec(`INSERT INTO operational_records(source_kind,id,business_date,status,pvz,fee_minor,cod_minor,client_type,payment_type,recipient_district,recipient_province)
   VALUES('dispatch','001','2026-11-01','test',NULL,1234,0,'legal','corporate','D','P'),('delivery','002','2026-11-02','test','Warehouse',100,500,'unknown','unknown','','Unknown');`);
  sqlite.exec("INSERT INTO upload_history(id,source_kind,mode,state,token_hash,base_revision,expected_rows,received_rows,received_chunks,applied_rows,created_at,completed_at,expires_at) VALUES('00000000-0000-0000-0000-000000000001','dispatch','add','complete','old-token',0,1,1,1,1,'2026-11-18T00:00:00.000Z','2026-11-18T00:01:00.000Z',9999999999999)");
  const result=await migrateFromSqlite(sqlite,pool);assert.deepEqual(result.map(r=>[r.source,r.records]),[['dispatch',1],['delivery',1]]);
  assert.ok(result.every(r=>r.sha256.length===64));
  assert.equal(Number((await pool.query('SELECT sum(record_count) count FROM daily_totals')).rows[0].count),2);
  assert.equal(Number((await pool.query('SELECT sum(fee_minor) amount FROM dispatch_payments_daily')).rows[0].amount),1234);
  assert.equal((await pool.query("SELECT pvz FROM operational_records WHERE id='001'")).rows[0].pvz,null);
  const history=(await pool.query('SELECT token_hash,expires_at,completed_at FROM upload_history')).rows;assert.equal(history.length,1);assert.notEqual(history[0].token_hash,'old-token');assert.equal(Number(history[0].expires_at),0);assert.equal(history[0].completed_at,'2026-11-18T00:01:00.000Z');
  await assert.rejects(migrateFromSqlite(sqlite,pool),/empty_target/);
 }finally{sqlite.close();await pg.close();}
});
