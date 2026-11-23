// Optional entry point: same public site, external PostgreSQL, no R2/Hyperdrive.
import legacy from '../server/api.mjs';
import {createPostgresAdapter} from './adapter.mjs';
import {createImports} from './imports.mjs';
import {createPool} from './connection.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const isReport=path=>['/api/dashboard','/api/history','/api/dispatch','/api/dispatch/compare'].includes(path);
async function readBody(request){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Object.assign(Error('json_required'),{status:415});
 let size=0;const parts=[];for await(const part of request.body||[]){size+=part.length;if(size>256000)throw Object.assign(Error('request_too_large'),{status:413});parts.push(part);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Object.assign(Error('invalid_json'),{status:400});}
}
export function createPostgresWorker(poolFactory=createPool){
 async function runJob(env){
  const pool=poolFactory(env);try{
   const imports=createImports(pool,{maxRows:50000,chunkRows:100,password:env.REPLACE_PASSWORD,clientKeys:JSON.parse(env.BEKBARAKA_CLIENT_KEYS||'[]'),publishTimeoutMs:20000});
   await imports.publishNext();await imports.cleanup();
  }catch(error){console.error('PUP_PG_JOB_RETRY',error.code||error.name||'Error');}finally{await pool.end();}
 }
 return {
  async scheduled(_controller,env,ctx){if(env.POSTGRES_DATABASE_URL||env.HYPERDRIVE)ctx.waitUntil(runJob(env));},
  async fetch(request,env,ctx){
   const url=new URL(request.url),path=url.pathname;
   if(path!=='/api'&&!path.startsWith('/api/'))return env.ASSETS.fetch(request);
   if(!env.POSTGRES_DATABASE_URL&&!env.HYPERDRIVE)return json({error:'database_not_configured'},503);
   if(!['GET','HEAD','POST'].includes(request.method))return json({error:'method_not_allowed'},405);
   // The deployment keeps the original URL; browser credentials never contain DB secrets.
   if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return json({error:'same_origin_required'},403);
   if(!env.UPLOAD_RATE_LIMITER)return json({error:'upload_rate_limit_not_configured'},503);
   const limit=await env.UPLOAD_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});if(!limit.success)return json({error:'rate_limited'},429);
   const cache=typeof caches==='undefined'?null:caches.default;
   const cacheUrl=new URL(request.url);cacheUrl.searchParams.sort();cacheUrl.searchParams.set('_pg_cache_generation',env.DB_GENERATION||'postgres-v1');
   const freshKey=new Request(cacheUrl);cacheUrl.searchParams.set('_last_good','1');const savedKey=new Request(cacheUrl);
   const report=request.method==='GET'&&isReport(path);
   if(report&&cache){const hit=await cache.match(freshKey);if(hit)return json((await hit.json()).body);}
   let pool;
   try{
    pool=poolFactory(env);
    const imports=createImports(pool,{maxRows:50000,chunkRows:100,password:env.REPLACE_PASSWORD,clientKeys:JSON.parse(env.BEKBARAKA_CLIENT_KEYS||'[]'),publishTimeoutMs:20000});
    if(path==='/api/config'&&request.method==='GET')return json({...imports.limits,maxBytes:50*1024*1024});
    let result;
    if(path==='/api/imports'||path.startsWith('/api/imports/')){
     result=await imports.handle(request,request.method==='POST'?await readBody(request):undefined)||json({error:'not_found'},404);
     // Status polls also resume a durable job after a disconnect or cold start.
     if(result.ok&&(/\/(complete|status)$/.test(path)))ctx.waitUntil(runJob(env));
    }else{
     const bindings={...env,DATABASE_PROVIDER:'postgres',PG_DATABASE:createPostgresAdapter(pool),REPORT_CACHE:undefined};
     result=await legacy.fetch(request,bindings);
    }
    if(report&&cache&&result.ok){const entry={body:await result.clone().json(),savedAt:new Date().toISOString()};
     ctx.waitUntil(Promise.all([
      cache.put(freshKey,Response.json(entry,{headers:{'Cache-Control':'public,max-age=15'}})),
      cache.put(savedKey,Response.json(entry,{headers:{'Cache-Control':'public,max-age=604800'}})),
     ]).catch(()=>{}));
    }
    if(report&&cache&&result.status>=500){const saved=await cache.match(savedKey);if(saved){const entry=await saved.json();return json({...entry.body,readMode:'fallback',snapshotAt:entry.savedAt});}}
    return result;
   }catch(error){
    if(!error.status)console.error('PUP_PG_REQUEST_FAILURE',error.code||error.name||'Error');
    if(report&&cache){const saved=await cache.match(savedKey);if(saved){const entry=await saved.json();return json({...entry.body,readMode:'fallback',snapshotAt:entry.savedAt});}}
    return json({error:error.status?error.message:'service_unavailable'},error.status||503);
   }finally{if(pool)await pool.end();}
  },
 };
}
export default createPostgresWorker();
