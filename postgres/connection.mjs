import pg from 'pg';
export function connectionOptions(env,{max=2}={}){
 if(env.HYPERDRIVE){
  if(env.HYPERDRIVE_TLS_VERIFIED!=='true')throw Error('hyperdrive_origin_tls_not_verified');
  // Hyperdrive's managed local connection uses its verified origin TLS policy.
  return {connectionString:env.HYPERDRIVE.connectionString,max,connectionTimeoutMillis:5000,idleTimeoutMillis:5000,statement_timeout:20000,application_name:'pup-analytics'};
 }
 const value=env.POSTGRES_DATABASE_URL||env.DATABASE_URL;if(!value)throw Error('postgres_not_configured');
 const url=new URL(value);if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.password)throw Error('invalid_postgres_url');
 // Explicit verified TLS cannot be disabled by connection-string SSL options.
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert','ssl'])url.searchParams.delete(key);
 return {connectionString:url.toString(),ssl:{rejectUnauthorized:true,...env.POSTGRES_CA_CERT&&{ca:env.POSTGRES_CA_CERT}},max,connectionTimeoutMillis:5000,idleTimeoutMillis:5000,statement_timeout:20000,application_name:'pup-analytics'};
}
export const createPool=env=>new pg.Pool(connectionOptions(env));
