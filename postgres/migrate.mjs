// Operator-only transfer. Input backups and credentials must never be committed.
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from './connection.mjs';
import {applyRollups} from './rollups.mjs';
const columns=['id','business_date','status','pvz','fee_minor','cod_minor','client_type','payment_type','recipient_district','recipient_province'];
const hash=()=>createHash('sha256');
export async function migrateFromSqlite(sqlite,pool){
 const client=await pool.connect();const verified=[];
 try{
  await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='30min'");
  await client.query('SELECT * FROM source_revision ORDER BY source_kind FOR UPDATE');
  const target=(await client.query('SELECT count(*) count FROM records_store')).rows[0];
  const history=(await client.query('SELECT count(*) count FROM upload_history')).rows[0];
  if(Number(target.count)||Number(history.count))throw Error('migration_requires_empty_target');
  for(const kind of ['dispatch','delivery']){
   const generation=randomUUID();let after='',count=0;const expected=hash();
   while(true){
    const rows=sqlite.prepare(`SELECT ${columns.join(',')} FROM operational_records WHERE source_kind=? AND id>? ORDER BY id LIMIT 1000`).all(kind,after);
    if(!rows.length)break;
    for(const row of rows)expected.update(JSON.stringify(columns.map(key=>row[key]))+'\n');
    await client.query(`INSERT INTO records_store(generation_id,source_kind,${columns.join(',')})
     SELECT $1::uuid,$2,x.* FROM jsonb_to_recordset($3::jsonb) AS x(id text,business_date text,status text,pvz text,fee_minor bigint,cod_minor bigint,client_type text,payment_type text,recipient_district text,recipient_province text)`,[generation,kind,JSON.stringify(rows)]);
    count+=rows.length;after=rows.at(-1).id;
   }
   await client.query('CREATE TEMP TABLE migration_records ON COMMIT DROP AS SELECT * FROM records_store WHERE generation_id=$1 AND source_kind=$2',[generation,kind]);
   await applyRollups(client,generation,kind,'migration_records');await client.query('DROP TABLE migration_records');
   const actual=hash();after='';let copied=0;
   while(true){
    const rows=(await client.query(`SELECT ${columns.join(',')} FROM records_store WHERE generation_id=$1 AND source_kind=$2 AND id>$3 ORDER BY id LIMIT 1000`,[generation,kind,after])).rows;
    if(!rows.length)break;
    for(const row of rows)actual.update(JSON.stringify(columns.map(key=>['fee_minor','cod_minor'].includes(key)?Number(row[key]):row[key]))+'\n');
    copied+=rows.length;after=rows.at(-1).id;
   }
   const digest=expected.digest('hex');if(copied!==count||actual.digest('hex')!==digest)throw Error('migration_fingerprint_mismatch');
   const revision=sqlite.prepare('SELECT revision FROM source_revision WHERE source_kind=?').get(kind)?.revision||0;
   const update=sqlite.prepare("SELECT max(value) value FROM (SELECT max(completed_at) value FROM upload_history WHERE source_kind=? AND state='complete' UNION ALL SELECT updated_at FROM data_updates WHERE source_kind=?)").get(kind,kind)?.value||null;
   await client.query('UPDATE source_revision SET generation_id=$2,revision=$3,updated_at=$4 WHERE source_kind=$1',[kind,generation,revision,update]);
   verified.push({source:kind,records:count,sha256:digest});
  }
  // Completed history is preserved. Old upload capabilities expire permanently.
  for(const row of sqlite.prepare("SELECT id,source_kind,mode,state,base_revision,expected_rows,received_rows,received_chunks,applied_rows,created_at,completed_at FROM upload_history WHERE state='complete'").all()){
   await client.query(`INSERT INTO upload_history(id,source_kind,mode,state,token_hash,base_revision,expected_rows,received_rows,received_chunks,applied_rows,created_at,completed_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0)`,[row.id,row.source_kind,row.mode,row.state,hash().update(randomUUID()).digest('hex'),row.base_revision,row.expected_rows,row.received_rows,row.received_chunks,row.applied_rows,row.created_at,row.completed_at]);
  }
  await client.query('COMMIT');return verified;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const input=process.argv[2];if(!input||!process.argv.includes('--approved-transfer'))throw Error('Fresh private SQLite backup and --approved-transfer required. Obtain owner approval for destination and payload first.');
 const sqlite=new DatabaseSync(input,{readOnly:true}),pool=createPool(process.env);
 try{await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));console.log(JSON.stringify(await migrateFromSqlite(sqlite,pool)));}
 finally{sqlite.close();await pool.end();}
}
