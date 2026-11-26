import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createApplication} from './application.mjs';
import {connectionOptions} from './connection.mjs';
const required=['DATABASE_URL','PUBLIC_SITE_ORIGIN','REPLACE_PASSWORD'];
for(const key of required)if(!process.env[key])throw Error('Missing server setting: '+key);
const pool=new pg.Pool({...connectionOptions(process.env,{max:8}),idleTimeoutMillis:30000,statement_timeout:30000});
pool.on('error',error=>console.error('PUP_POOL_FAILURE',error.code||'Error'));
// Schema changes are explicit and versioned, not an unreviewed startup side effect.
if(process.argv.includes('--migrate')){
 await pool.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));await pool.end();console.log('PostgreSQL schema ready');
}else{
 await pool.query('SELECT version FROM pg_schema_version WHERE version=1');
 const app=createApplication(pool,{siteOrigin:process.env.PUBLIC_SITE_ORIGIN,password:process.env.REPLACE_PASSWORD,clientKeys:JSON.parse(process.env.BEKBARAKA_CLIENT_KEYS||'[]'),cacheDirectory:process.env.REPORT_CACHE_DIRECTORY});
 const server=createServer(async(req,res)=>{
  try{
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
   const forwarded=process.env.TRUST_PROXY==='1'?String(req.headers['x-forwarded-for']||'').split(',').at(-1)?.trim():null;
   const clientIp=forwarded||req.socket.remoteAddress||'unknown';
   let bytes=0,parts=[],data;
   if(req.method==='POST'){
    if(headers.get('origin')!==process.env.PUBLIC_SITE_ORIGIN)throw Object.assign(Error('same_origin_required'),{status:403});
    if(!headers.get('content-type')?.startsWith('application/json'))throw Object.assign(Error('json_required'),{status:415});
    for await(const part of req){bytes+=part.length;if(bytes>2000000)throw Object.assign(Error('request_too_large'),{status:413});parts.push(part);}
    try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Object.assign(Error('invalid_json'),{status:400});}
   }
   const request=new Request('http://api.internal'+req.url,{method:req.method,headers});
   const result=await app.fetch(request,{clientIp,data});
   res.writeHead(result.status,Object.fromEntries(result.headers));res.end(req.method==='HEAD'?undefined:Buffer.from(await result.arrayBuffer()));
  }catch(error){res.writeHead(error.status||503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.status?error.message:'service_unavailable'}));}
 });
 server.maxConnections=100;server.headersTimeout=15000;server.requestTimeout=120000;server.maxHeadersCount=40;
 server.listen(Number(process.env.PORT||8080),process.env.HOST||'127.0.0.1',()=>console.log('PUP PostgreSQL API ready'));
 let busy=false,closing=false,lastCleanup=0;
 const tick=async()=>{
  if(busy||closing)return;busy=true;
  try{const result=await app.imports.publishNext();if(result)app.invalidate();if(Date.now()-lastCleanup>60000){await app.imports.cleanup();lastCleanup=Date.now();}}
  catch(error){console.error('PUP_JOB_RETRY',error.code||error.name||'Error');}finally{busy=false;}
 };
 const timer=setInterval(tick,2000);timer.unref();void tick();
 const stop=()=>{if(closing)return;closing=true;clearInterval(timer);server.close(async()=>{while(busy)await new Promise(resolve=>setTimeout(resolve,200));await pool.end();process.exit(0);});};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
