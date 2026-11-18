import {periodRange,comparison} from './periods.mjs';
function group(params,label){
 const from=params.get('from'+label),to=params.get('to'+label);periodRange('custom',to,from,to);
 let warehouses;try{warehouses=JSON.parse(params.get('pvzs'+label)||'[]');}catch{throw Error('invalid_group');}
 if(!Array.isArray(warehouses)||warehouses.length>50||warehouses.some(x=>typeof x!=='string'||x.length>200))throw Error('invalid_group');
 return {from,to,pvzs:[...new Set(warehouses)]};
}
export async function compareDispatch(db,params){
 const a=group(params,'A'),b=group(params,'B');
 const meta=await db.prepare("SELECT min(business_date) minDate,max(business_date) maxDate FROM daily_totals WHERE source_kind='dispatch'").first();
 const where="source_kind='dispatch' AND business_date BETWEEN ? AND ? AND (json_array_length(?)=0 OR pvz IN(SELECT value FROM json_each(?)))";
 const queries=[a,b].map(g=>{const j=JSON.stringify(g.pvzs);return db.prepare(`SELECT coalesce(sum(record_count),0) count,coalesce(sum(fee_minor),0) amount FROM daily_totals WHERE ${where}`).bind(g.from,g.to,j,j);});
 const results=await db.batch(queries);
 const covered=g=>!!meta.minDate&&g.from>=meta.minDate&&g.to<=meta.maxDate;
 const A={...a,...results[0].results[0],covered:covered(a)},B={...b,...results[1].results[0],covered:covered(b)};
 return {A,B,coverage:meta,growth:{count:comparison(A.count,B.count,A.covered&&B.covered),amount:comparison(A.amount,B.amount,A.covered&&B.covered)}};
}
export async function dispatchIds(db,params){
 const from=params.get('from'),to=params.get('to');periodRange('custom',to,from,to);
 const province=params.get('province'),pvz=params.has('pvz')?params.get('pvz'):null,district=params.get('district'),cursor=params.get('after')||'';
 if(!province||province.length>200||pvz!==null&&pvz.length>200||district&&district.length>200||cursor.length>128)throw Error('invalid_filter');
 const query=db.prepare(`SELECT id FROM operational_records WHERE source_kind='dispatch' AND id>? AND business_date BETWEEN ? AND ?
   AND recipient_province=? AND (? IS NULL OR coalesce(pvz,'')=?) AND (? IS NULL OR recipient_district=?) ORDER BY id LIMIT 201`)
   .bind(cursor,from,to,province,pvz,pvz,district,district);
 const batch=await db.batch([db.prepare("SELECT revision FROM source_revision WHERE source_kind='dispatch'"),query]);
 const revision=batch[0].results[0].revision,expected=params.get('revision');
 if(expected!==null&&String(revision)!==expected)throw Error('invalid_data_changed');
 const results=batch[1].results,ids=results.slice(0,200).map(r=>r.id);return {ids,nextCursor:results.length>200?ids.at(-1):null,revision};
}
