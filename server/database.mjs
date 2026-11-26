import {createLibsqlAdapter,validateTursoConfig} from './libsql-adapter.mjs';
const clients=new WeakMap();
export function databaseProvider(env){return env.DATABASE_PROVIDER||'d1';}
export function databaseConfigured(env){const p=databaseProvider(env);return p==='postgres'?!!env.PG_DATABASE:p==='turso'?!!env.TURSO_DATABASE_URL&&!!env.TURSO_AUTH_TOKEN:p==='d1'&&!!env.DB;}
export async function getDatabase(env,factory){
 const provider=databaseProvider(env);
 if(provider==='postgres'){if(!env.PG_DATABASE)throw Error('database_not_configured');return env.PG_DATABASE;}
 if(provider==='d1'){if(!env.DB)throw Error('database_not_configured');return env.DB;}
 if(provider!=='turso')throw Error('unknown_database_provider');
 if(clients.has(env))return clients.get(env);
 const config=validateTursoConfig(env);
 const create=factory||(await import('@libsql/client/web')).createClient;
 const db=createLibsqlAdapter(create(config));clients.set(env,db);return db;
}
