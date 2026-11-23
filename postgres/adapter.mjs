// Only server-owned SQL is accepted. User values remain positional parameters.
export function placeholders(sql){
 let n=0,quoted=false;let out='';
 for(let i=0;i<sql.length;i++){
  const c=sql[i];
  if(c==="'"){out+=c;if(quoted&&sql[i+1]==="'"){out+=sql[++i];continue;}quoted=!quoted;continue;}
  out+=c==='?'&&!quoted?'$'+(++n):c;
 }
 return out;
}
function numeric(value){
 if(typeof value==='bigint'){if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))throw Error('database_integer_out_of_range');return Number(value);}
 return value;
}
export function convertResult(result){
 const types=new Map((result.fields||[]).map(f=>[f.name,f.dataTypeID]));
 const rows=result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>{
  if(v!==null&&[20,1700].includes(types.get(k))&&typeof v==='string'){
   if(!/^-?\d+$/.test(v))throw Error('non_integer_database_total');v=BigInt(v);
  }
  return [k,numeric(v)];
 })));
 return {success:true,results:rows,meta:{changes:result.rowCount||0}};
}
export function createPostgresAdapter(pool){
 const owner=Symbol('postgres');
 const prepare=(sql,values=[])=>({owner,sql:placeholders(sql),values,
  bind(...args){if(args.some(v=>v===undefined))throw Error('undefined_sql_parameter');return prepare(sql,args);},
  async first(column){const row=(await this.all()).results[0];return row?(column===undefined?row:row[column]):null;},
  async all(){return convertResult(await pool.query(this.sql,this.values));},
  async run(){const result=await this.all();return {success:true,meta:result.meta};},
 });
 return {dialect:'postgres',prepare,async batch(statements){
  if(!statements.length||statements.some(s=>s.owner!==owner))throw Error('invalid_batch');
  const client=await pool.connect();try{
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const result=[];for(const s of statements)result.push(convertResult(await client.query(s.sql,s.values)));
   await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }};
}
