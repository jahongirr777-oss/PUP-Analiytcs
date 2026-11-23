import worker from '../server/api.mjs';
import {createPostgresAdapter} from './adapter.mjs';
import {createImports} from './imports.mjs';
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,writeFile,rename,unlink} from 'node:fs/promises';
const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function createLimiter({limit=120,period=60,maxKeys=10000,now=Date.now}={}){
 const keys=new Map();
 return {async limit({key}){
  const stamp=Math.floor(now()/1000/period);let value=keys.get(key);
  if(!value||value.stamp!==stamp){if(keys.size>=maxKeys){for(const [k,v] of keys)if(v.stamp!==stamp)keys.delete(k);if(keys.size>=maxKeys)return {success:false};}value={stamp,count:0};keys.set(key,value);}
  return {success:++value.count<=limit};
 }};
}
export function createApplication(pool,options){
 const site=new URL(options.siteOrigin);if(site.origin!==options.siteOrigin||!['https:','http:'].includes(site.protocol))throw Error('invalid_site_origin');
 const now=options.now||Date.now;
 const allowed=options.siteOrigin,imports=createImports(pool,options),reports=new Map(),limiter=createLimiter({limit:600});
 const env={DATABASE_PROVIDER:'postgres',PG_DATABASE:createPostgresAdapter(pool),UPLOAD_RATE_LIMITER:createLimiter({limit:120}),DB_GENERATION:'postgres-v1'};
 const reportPath=path=>['/api/dashboard','/api/history','/api/dispatch','/api/dispatch/compare'].includes(path);
 const cacheKey=url=>{const normalized=new URL(url);normalized.searchParams.sort();return normalized.pathname+normalized.search;};
 const cacheFile=key=>createHash('sha256').update(key).digest('hex')+'.json';
 const maxEntries=100;
 async function initializeCache(){
  if(!options.cacheDirectory)return;
  await mkdir(options.cacheDirectory,{recursive:true,mode:0o700});
  const files=(await readdir(options.cacheDirectory)).filter(x=>/^[a-f0-9]{64}\.json$/.test(x));
  for(const file of files.slice(-maxEntries))try{
   const text=await readFile(options.cacheDirectory+'/'+file,'utf8');if(text.length>2000000)continue;
   const entry=JSON.parse(text),url=new URL(entry.key,'https://cache.invalid');
   if(reportPath(url.pathname)&&entry.savedAt&&entry.body&&!entry.body.error)reports.set(entry.key,{...entry,until:0});
  }catch{}
 }
 const ready=initializeCache().catch(()=>console.error('PUP_REPORT_CACHE_UNAVAILABLE'));
 async function save(key,body){
  const entry={key,body,savedAt:new Date().toISOString(),until:now()+15000};
  if(JSON.stringify(entry).length>2000000)return;
  if(reports.size>=maxEntries&&!reports.has(key)){
   const oldest=reports.keys().next().value;reports.delete(oldest);
   if(options.cacheDirectory)await unlink(options.cacheDirectory+'/'+cacheFile(oldest)).catch(()=>{});
  }
  reports.set(key,entry);
  if(options.cacheDirectory){const file=options.cacheDirectory+'/'+cacheFile(key);await writeFile(file+'.tmp',JSON.stringify(entry),{mode:0o600});await rename(file+'.tmp',file);}
 }
 function cors(result,origin){
  const headers=new Headers(result.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Cache-Control','no-store');
  if(origin===allowed){headers.set('Access-Control-Allow-Origin',allowed);headers.set('Vary','Origin');headers.set('Access-Control-Allow-Methods','GET,HEAD,POST,OPTIONS');headers.set('Access-Control-Allow-Headers','Content-Type,X-Replace-Password,X-Upload-Token');headers.set('Access-Control-Max-Age','600');}
  return new Response(result.body,{status:result.status,headers});
 }
 async function fetch(request,{clientIp='unknown',data}={}){
  const url=new URL(request.url),path=url.pathname,origin=request.headers.get('Origin');
  const finish=result=>cors(result,origin);
  try{
   if(origin&&origin!==allowed)return finish(response({error:'origin_not_allowed'},403));
   if(request.method==='OPTIONS')return finish(new Response(null,{status:204}));
   if(path==='/api/health'&&['GET','HEAD'].includes(request.method)){
    await pool.query('SELECT 1');return finish(request.method==='HEAD'?new Response(null,{status:200}):response({ok:true,mode:'live',database_connected:true}));
   }
   if(!path.startsWith('/api/'))return finish(response({error:'not_found'},404));
   if(!['GET','HEAD','POST'].includes(request.method))return finish(response({error:'method_not_allowed'},405));
   if(!(await limiter.limit({key:clientIp})).success)return finish(response({error:'rate_limited'},429));
   if(request.method==='POST'&&origin!==allowed)return finish(response({error:'same_origin_required'},403));
   if(path==='/api/config'&&request.method==='GET')return finish(await imports.handle(request));
   if(path==='/api/imports'||path.startsWith('/api/imports/')){
    const result=await imports.handle(request,data);return finish(result||response({error:'not_found'},404));
   }
   if(request.method!=='GET')return finish(response({error:'not_found'},404));
   await ready;
   const key=cacheKey(url),saved=reportPath(path)?reports.get(key):null;
   if(saved&&saved.until>now())return finish(response(saved.body));
   const headers=new Headers(request.headers);headers.set('CF-Connecting-IP',clientIp);
   const result=await worker.fetch(new Request(request,{headers}),env);
   if(result.ok&&reportPath(path)){const body=await result.clone().json();await save(key,body).catch(()=>{});}
   if(result.status>=500&&saved)return finish(response({...saved.body,readMode:'fallback',snapshotAt:saved.savedAt}));
   return finish(result);
  }catch(error){
   // Never log SQL, bind parameters, uploaded rows, passwords or tokens.
   if(!error.status)console.error('PUP_API_FAILURE',error.code||error.name||'Error');
   return finish(response({error:error.status?error.message:'service_unavailable'},error.status||503));
  }
 }
 function invalidate(){for(const entry of reports.values())entry.until=0;}
 return {fetch,imports,invalidate};
}
