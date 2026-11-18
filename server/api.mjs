import {normalizeRecord} from './record.mjs';
import {publicationStatements} from './publish.mjs';
import {dispatchAnalytics} from './dispatch-analytics.mjs';
import {compareDispatch,dispatchIds} from './dispatch-compare.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(body,status=200)=>Response.json(body,{status,headers});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
async function body(request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))fail('json_required',415);
  const reader=request.body?.getReader();if(!reader)fail('empty_request');
  let size=0,parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256000){await reader.cancel();fail('request_too_large',413);}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('invalid_json');}
}
async function replacement(request,env){
  if(!env.REPLACE_PASSWORD)fail('replacement_not_configured',503);
  if(await hash(request.headers.get('X-Replace-Password')||'')!==await hash(env.REPLACE_PASSWORD))fail('wrong_password',403);
}
async function jobAccess(request,db,id){
  const job=await db.prepare('SELECT * FROM upload_history WHERE id=?').bind(id).first();
  if(!job||await hash(request.headers.get('X-Upload-Token')||'')!==job.token_hash)fail('upload_not_found',404);
  if(job.expires_at<Date.now())fail('upload_expired',410);
  return job;
}
export default {
  async scheduled(_controller,env){
    if(!env.DB)return;
    await env.DB.batch([
      env.DB.prepare("UPDATE upload_history SET state='cancelled' WHERE state='uploading' AND expires_at<?").bind(Date.now()),
      env.DB.prepare("DELETE FROM upload_chunks WHERE upload_id IN (SELECT id FROM upload_history WHERE state='cancelled')"),
    ]);
  },
  async fetch(request,env){
    const url=new URL(request.url),path=url.pathname;
    if(path!=='/api'&&!path.startsWith('/api/'))return env.ASSETS.fetch(request);
    try{
      if(path==='/api/health'){
        if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
        const result=json({ok:true,mode:env.DB?'live':'setup',database_connected:!!env.DB});
        return request.method==='HEAD'?new Response(null,{headers:result.headers}):result;
      }
      if(!env.DB)fail('database_not_configured',503);
      const db=env.DB;
      if(request.method==='GET'&&path==='/api/dispatch/ids'){
        if(!env.UPLOAD_RATE_LIMITER)fail('read_limit_not_configured',503);
        const limit=await env.UPLOAD_RATE_LIMITER.limit({key:'ids:'+ (request.headers.get('CF-Connecting-IP')||'unknown')});if(!limit.success)fail('rate_limited',429);
        try{return json(await dispatchIds(db,url.searchParams));}catch(error){if(/^invalid_/.test(error.message))fail(error.message);throw error;}
      }
      if(request.method==='GET'&&['/api/dispatch','/api/dispatch/compare'].includes(path)){
        try{
          // Cache public aggregates by source revision: a successful replacement
          // invalidates them immediately without exposing personal rows or secrets.
          const cache=typeof caches==='undefined'?null:caches.default;
          let key;
          if(cache){
            const revision=await db.prepare("SELECT revision FROM source_revision WHERE source_kind='dispatch'").first();
            const cacheUrl=new URL(request.url);cacheUrl.searchParams.set('_source_revision',String(revision.revision));cacheUrl.searchParams.set('_analytics_version','2026-11-18-v3');key=new Request(cacheUrl);
            const hit=await cache.match(key);if(hit)return json(await hit.json());
          }
          const report=await (path.endsWith('/compare')?compareDispatch(db,url.searchParams):dispatchAnalytics(db,url.searchParams));
          if(cache)try{await cache.put(key,Response.json(report,{headers:{'Cache-Control':'public,max-age=300'}}));}catch{}
          return json(report);
        }catch(error){
          if(/^invalid_/.test(error.message))fail(error.message);throw error;
        }
      }
      if(request.method==='GET'&&path==='/api/history'){
        const before=url.searchParams.get('before');
        if(before&&!/^\d{4}-\d\d-\d\dT[\d:.]+Z\|[\da-f-]{36}$/.test(before))fail('invalid_cursor');
        const [date,id]=before?before.split('|'):['9999',''];
        const {results}=await db.prepare(`SELECT id,source_kind,mode,state,expected_rows,received_rows,applied_rows,created_at,completed_at
          FROM upload_history WHERE created_at<? OR (created_at=? AND id<?) ORDER BY created_at DESC,id DESC LIMIT 50`).bind(date,date,id).all();
        const last=results.at(-1);return json({items:results,nextCursor:results.length===50?last.created_at+'|'+last.id:null});
      }
      if(request.method==='GET'&&path==='/api/dashboard'){
        const from=url.searchParams.get('from')||'2000-01-01',to=url.searchParams.get('to')||'2100-12-31';
        if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)fail('invalid_date_range');
        const data=await db.batch([
          db.prepare(`SELECT source_kind,pvz,sum(record_count) count,sum(fee_minor) fee_minor,sum(cod_minor) cod_minor
            FROM daily_totals WHERE business_date BETWEEN ? AND ? GROUP BY source_kind,pvz ORDER BY pvz`).bind(from,to),
          db.prepare("SELECT max(value) last_upload FROM (SELECT max(completed_at) value FROM upload_history WHERE state='complete' UNION ALL SELECT max(updated_at) FROM data_updates)"),
          db.prepare('SELECT min(business_date) minDate,max(business_date) maxDate FROM daily_totals'),
        ]);
        return json({rows:data[0].results,lastUpload:data[1].results[0]?.last_upload||null,coverage:data[2].results[0]});
      }
      if(request.method!=='POST')return json({error:'not_found'},404);
      if(request.headers.get('Origin')!==url.origin)fail('same_origin_required',403);
      // Public additive imports are intentional; fail closed without rate limiting.
      if(!env.UPLOAD_RATE_LIMITER)fail('upload_rate_limit_not_configured',503);
      const limit=await env.UPLOAD_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});
      if(!limit.success)fail('rate_limited',429);
      if(path==='/api/imports'){
        const b=await body(request);
        if(!['dispatch','delivery'].includes(b.kind)||!['add','replace'].includes(b.mode)||!Number.isInteger(b.rows)||b.rows<1||b.rows>50000)fail('invalid_import');
        if(b.mode==='replace'){
          await replacement(request,env);
          if(b.confirmReplace!==true)fail('replacement_confirmation_required');
        }
        const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID();
        await db.prepare(`INSERT INTO upload_history(id,source_kind,mode,token_hash,base_revision,expected_rows,expires_at)
          SELECT ?,?,?,?,revision,?,? FROM source_revision WHERE source_kind=?`).bind(id,b.kind,b.mode,await hash(token),b.rows,Date.now()+86400000,b.kind).run();
        return json({id,token},201);
      }
      const match=/^\/api\/imports\/([\da-f-]{36})\/(chunk|complete|cancel)$/.exec(path);
      if(!match)return json({error:'not_found'},404);
      const job=await jobAccess(request,db,match[1]);
      if(match[2]==='cancel'){
        await db.batch([
          db.prepare("UPDATE upload_history SET state='cancelled' WHERE id=? AND state='uploading'").bind(job.id),
          db.prepare("DELETE FROM upload_chunks WHERE upload_id=? AND EXISTS(SELECT 1 FROM upload_history WHERE id=? AND state='cancelled')").bind(job.id,job.id),
        ]);return json({ok:true});
      }
      if(match[2]==='complete'&&job.state==='complete')return json({ok:true,appliedRows:job.applied_rows});
      if(job.state!=='uploading')fail('upload_not_open',409);
      if(match[2]==='chunk'){
        const b=await body(request);
        if(!Number.isInteger(b.seq)||b.seq<0||!Array.isArray(b.rows)||b.rows.length<1||b.rows.length>100)fail('invalid_chunk');
        let rows;try{const clientKeys=env.BEKBARAKA_CLIENT_KEYS?JSON.parse(env.BEKBARAKA_CLIENT_KEYS):[];rows=b.rows.map(r=>normalizeRecord(r,{sourceKind:job.source_kind,clientKeys}));}catch{fail('invalid_record');}
        const payload=JSON.stringify(rows),digest=await hash(payload);
        const prior=await db.prepare('SELECT digest FROM upload_chunks WHERE upload_id=? AND seq=?').bind(job.id,b.seq).first();
        if(prior){if(prior.digest!==digest)fail('chunk_conflict',409);return json({ok:true,replayed:true});}
        if(b.seq!==job.received_chunks)fail('chunk_out_of_order',409);
        await db.prepare('INSERT INTO upload_chunks(upload_id,seq,digest,payload) VALUES (?,?,?,?)').bind(job.id,b.seq,digest,payload).run();
        return json({ok:true});
      }
      if(job.mode==='replace')await replacement(request,env);
      if(job.received_rows!==job.expected_rows)fail('incomplete_upload',409);
      const revision=await db.prepare('SELECT revision FROM source_revision WHERE source_kind=?').bind(job.source_kind).first();
      if(revision.revision!==job.base_revision)fail('data_changed_start_again',409);
      try{await db.batch(publicationStatements(db,job));}catch{fail('publication_failed_existing_data_unchanged',409);}
      const result=await db.prepare('SELECT applied_rows FROM upload_history WHERE id=?').bind(job.id).first();
      return json({ok:true,appliedRows:result.applied_rows});
    }catch(error){return json({error:error.status?error.message:'service_unavailable'},error.status||503);}
  },
};
