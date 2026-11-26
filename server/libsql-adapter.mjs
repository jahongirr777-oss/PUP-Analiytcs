// Compatibility boundary. Credentials remain inside the Worker environment.
function number(value){
 if(typeof value!=='bigint')return value;
 if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw Error('database_integer_out_of_range');
 return Number(value);
}
function result(value){
 const results=value.rows.map(row=>Object.fromEntries(value.columns.map(name=>[name,number(row[name])])));
 return {success:true,results,meta:{changes:value.rowsAffected||0,last_row_id:value.lastInsertRowid===undefined?0:number(value.lastInsertRowid)}};
}
export function createLibsqlAdapter(client){
 const owner=Symbol('database');
 function prepare(sql,args=[]){
  if(typeof sql!=='string'||!sql.trim())throw Error('invalid_statement');
  const statement={sql,args:[...args]};
  return {owner,statement,
   bind(...values){if(values.some(v=>v===undefined))throw Error('undefined_sql_parameter');return prepare(sql,values);},
   async first(column){const row=result(await client.execute(statement)).results[0];return row?(column===undefined?row:row[column]):null;},
   async all(){return result(await client.execute(statement));},
   async run(){const value=result(await client.execute(statement));return {success:true,meta:value.meta};},
  };
 }
 return {prepare,
  async batch(statements){
   if(!Array.isArray(statements)||!statements.length||statements.some(s=>s.owner!==owner))throw Error('invalid_batch');
   const queries=statements.map(s=>s.statement),mode=queries.every(s=>/^\s*SELECT\b/i.test(s.sql))?'read':'write';
   return (await client.batch(queries,mode)).map(result);
  },
 };
}
export function validateTursoConfig(env){
 if(typeof env.TURSO_DATABASE_URL!=='string'||!env.TURSO_AUTH_TOKEN?.trim())throw Error('turso_not_configured');
 let url;try{url=new URL(env.TURSO_DATABASE_URL);}catch{throw Error('invalid_turso_url');}
 if(!['libsql:','https:'].includes(url.protocol)||!url.hostname.endsWith('.turso.io')||url.username||url.password||url.search||url.hash||url.port&&url.port!=='443'||url.pathname&&url.pathname!=='/')throw Error('invalid_turso_url');
 return {url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN,intMode:'bigint'};
}
