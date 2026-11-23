import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {normalizeRecord} from '../server/record.mjs';
import {applyRollups} from './rollups.mjs';
export const hash=text=>createHash('sha256').update(text).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const same=(a,b)=>timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)));
export function checkReplacement(request,password){if(!password)fail('replacement_not_configured',503);if(!same(request.headers.get('X-Replace-Password')||'',password))fail('wrong_password',403);}
const columns='id,business_date,status,pvz,fee_minor,cod_minor,client_type,payment_type,recipient_district,recipient_province';
export function createImports(pool,options={}){
 const maxRows=options.maxRows||2000000,chunkRows=options.chunkRows||500,now=options.now||Date.now;
 const limits={maxRows,maxBytes:512*1024*1024,chunkRows,asyncPublication:true};
 async function access(client,request,id,lock=false){
  const job=(await client.query('SELECT * FROM upload_history WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];
  if(!job||!timingSafeEqual(Buffer.from(hash(request.headers.get('X-Upload-Token')||'')),Buffer.from(job.token_hash)))fail('upload_not_found',404);
  if(Number(job.expires_at)<now())fail('upload_expired',410);return job;
 }
 async function transaction(fn,timeoutMs){const client=await pool.connect();try{await client.query('BEGIN');const started=Date.now();
 const bounded=timeoutMs?{async query(sql,values){const remaining=timeoutMs-(Date.now()-started);if(remaining<250)fail('import_too_large_split_file',409);await client.query("SELECT set_config('statement_timeout',$1,true)",[String(remaining)]);return client.query(sql,values);}}:client;
 const result=await fn(bounded);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
 async function handle(request,data){
  const url=new URL(request.url),path=url.pathname;
  if(path==='/api/config')return json(limits);
  if(path==='/api/imports'&&request.method==='POST'){
   const b=data;
   if(!['dispatch','delivery'].includes(b.kind)||!['add','replace'].includes(b.mode)||!Number.isInteger(b.rows)||b.rows<1||b.rows>maxRows)fail('invalid_import');
   if(b.mode==='replace'){checkReplacement(request,options.password);if(b.confirmReplace!==true)fail('replacement_confirmation_required');}
   return transaction(async client=>{
    // Serialize admission to bound staging disk even with concurrent visitors.
    await client.query('SELECT revision FROM source_revision ORDER BY source_kind FOR UPDATE');
    const open=(await client.query("SELECT count(*) count,coalesce(sum(expected_rows),0) rows FROM upload_history WHERE state IN ('uploading','publishing') AND expires_at>$1",[now()])).rows[0];
    if(Number(open.count)>=4||Number(open.rows)+b.rows>maxRows*2)fail('import_queue_full',429);
    const id=randomUUID(),token=randomUUID()+randomUUID();
    await client.query(`INSERT INTO upload_history(id,source_kind,mode,token_hash,base_revision,expected_rows,expires_at)
     SELECT $1,$2,$3,$4,revision,$5,$6 FROM source_revision WHERE source_kind=$2`,[id,b.kind,b.mode,hash(token),b.rows,now()+48*3600000]);
    return json({id,token},201);
   });
  }
  const match=/^\/api\/imports\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\/(chunk|complete|cancel|status)$/.exec(path);if(!match)return null;
  if(request.method==='GET'&&match[2]==='status'){
   const job=await access(pool,request,match[1]);return json({state:job.state,appliedRows:Number(job.applied_rows),error:job.error_code||undefined});
  }
  if(request.method!=='POST')fail('method_not_allowed',405);
  return transaction(async client=>{
   const job=await access(client,request,match[1],true),action=match[2];
   if(action==='cancel'){
    if(job.state==='uploading')await client.query("UPDATE upload_history SET state='cancelled' WHERE id=$1",[job.id]);
    return json({ok:true,state:job.state==='uploading'?'cancelled':job.state});
   }
   if(action==='complete'&&['publishing','complete','failed'].includes(job.state))return json({ok:job.state!=='failed',state:job.state,appliedRows:Number(job.applied_rows),error:job.error_code||undefined},job.state==='failed'?409:job.state==='publishing'?202:200);
   if(job.state!=='uploading')fail('upload_not_open',409);
   if(action==='chunk'){
    const b=data;if(!Number.isInteger(b.seq)||b.seq<0||!Array.isArray(b.rows)||b.rows.length<1||b.rows.length>chunkRows)fail('invalid_chunk');
    let rows;try{rows=b.rows.map(row=>normalizeRecord(row,{sourceKind:job.source_kind,clientKeys:options.clientKeys||[]}));}catch{fail('invalid_record');}
    const digest=hash(JSON.stringify(rows));const prior=(await client.query('SELECT digest FROM upload_chunks WHERE upload_id=$1 AND seq=$2',[job.id,b.seq])).rows[0];
    if(prior){if(prior.digest!==digest)fail('chunk_conflict',409);return json({ok:true,replayed:true});}
    if(b.seq!==Number(job.received_chunks))fail('chunk_out_of_order',409);
    if(Number(job.received_rows)+rows.length>Number(job.expected_rows))fail('invalid_chunk');
    const payload=rows.map(r=>({id:r.id,business_date:r.businessDate,status:r.status,pvz:r.pvz,fee_minor:r.deliveryFeeMinor,cod_minor:r.codMinor,client_type:r.clientType,payment_type:r.paymentType,recipient_district:r.recipientDistrict,recipient_province:r.recipientProvince}));
    try{await client.query(`INSERT INTO import_records(upload_id,${columns})
     SELECT $1,x.* FROM jsonb_to_recordset($2::jsonb) AS x(id text,business_date text,status text,pvz text,fee_minor bigint,cod_minor bigint,client_type text,payment_type text,recipient_district text,recipient_province text)`,[job.id,JSON.stringify(payload)]);}catch(error){if(error.code==='23505')fail('duplicate_id_in_file',409);throw error;}
    await client.query('INSERT INTO upload_chunks(upload_id,seq,digest) VALUES($1,$2,$3)',[job.id,b.seq,digest]);
    await client.query('UPDATE upload_history SET received_rows=received_rows+$2,received_chunks=received_chunks+1 WHERE id=$1',[job.id,rows.length]);
    return json({ok:true});
   }
   if(action==='complete'){
    if(job.mode==='replace')checkReplacement(request,options.password);
    if(Number(job.received_rows)!==Number(job.expected_rows))fail('incomplete_upload',409);
    await client.query("UPDATE upload_history SET state='publishing' WHERE id=$1",[job.id]);return json({ok:true,state:'publishing'},202);
   }
   fail('not_found',404);
  });
 }
 async function publishNext(){
  let jobId;try{return await transaction(async client=>{
   // A crashed process releases this transaction lock; the job is retried on restart.
   const job=(await client.query("SELECT * FROM upload_history WHERE state='publishing' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
   if(!job)return false;jobId=job.id;
   if(!options.publishTimeoutMs)await client.query("SET LOCAL statement_timeout='30min'");
   const source=(await client.query('SELECT * FROM source_revision WHERE source_kind=$1 FOR UPDATE',[job.source_kind])).rows[0];
   if(Number(source.revision)!==Number(job.base_revision))fail('data_changed_start_again',409);
   const count=(await client.query('SELECT count(*) count FROM import_records WHERE upload_id=$1',[job.id])).rows[0];
   if(Number(count.count)!==Number(job.expected_rows))fail('incomplete_upload',409);
   const generation=job.mode==='replace'?randomUUID():source.generation_id;
   await client.query(`CREATE TEMP TABLE applied_import ON COMMIT DROP AS
    WITH inserted AS(INSERT INTO records_store(generation_id,source_kind,${columns})
     SELECT $2::uuid,$3,${columns} FROM import_records WHERE upload_id=$1 ON CONFLICT DO NOTHING RETURNING *)
    SELECT * FROM inserted`,[job.id,generation,job.source_kind]);
   const applied=Number((await client.query('SELECT count(*) count FROM applied_import')).rows[0].count);
   await applyRollups(client,generation,job.source_kind);
   const completed=new Date(now()).toISOString();
   await client.query('UPDATE source_revision SET generation_id=$2,revision=revision+1,updated_at=$3 WHERE source_kind=$1',[job.source_kind,generation,completed]);
   await client.query("UPDATE upload_history SET state='complete',completed_at=$2,applied_rows=$3 WHERE id=$1",[job.id,completed,applied]);
   if(job.mode==='replace')await client.query('INSERT INTO retired_generations(generation_id,retired_at) VALUES($1,$2) ON CONFLICT DO NOTHING',[source.generation_id,now()]);
   return {id:job.id,appliedRows:applied};
  },options.publishTimeoutMs);}catch(error){
   if(jobId&&(error.status||['23505','23514','22003','57014'].includes(error.code))){
    await pool.query("UPDATE upload_history SET state='failed',error_code=$2 WHERE id=$1 AND state='publishing'",[jobId,error.status?error.message:error.code==='57014'?'import_too_large_split_file':'publication_failed_existing_data_unchanged']);
    return {id:jobId,failed:true};
   }
   // Connection/timeouts leave a durable pending job; the next worker retries it.
   throw error;
  }
 }
 async function cleanup(){
  await pool.query("UPDATE upload_history SET state='cancelled' WHERE state='uploading' AND expires_at<$1",[now()]);
  await pool.query("DELETE FROM import_records WHERE ctid IN(SELECT r.ctid FROM import_records r JOIN upload_history h ON h.id=r.upload_id WHERE h.state IN('complete','cancelled','failed') LIMIT 5000)");
  await pool.query("DELETE FROM upload_chunks WHERE upload_id IN(SELECT id FROM upload_history WHERE state IN('complete','cancelled','failed'))");
  const old=(await pool.query('SELECT generation_id FROM retired_generations WHERE retired_at<$1 ORDER BY retired_at LIMIT 1',[now()-86400000])).rows[0];
  if(old){
   await transaction(async client=>{
    const active=(await client.query('SELECT 1 FROM source_revision WHERE generation_id=$1',[old.generation_id])).rows.length;if(active)return;
    const deleted=await client.query('DELETE FROM records_store WHERE ctid IN(SELECT ctid FROM records_store WHERE generation_id=$1 LIMIT 5000)',[old.generation_id]);
    if(!deleted.rowCount){for(const table of ['daily_totals_store','dispatch_cube_store','dispatch_clients_daily_store','dispatch_payments_daily_store','dispatch_routes_daily_store','retired_generations'])await client.query(`DELETE FROM ${table} WHERE generation_id=$1`,[old.generation_id]);}
   });
  }
 }
 return {handle,publishNext,cleanup,limits};
}
