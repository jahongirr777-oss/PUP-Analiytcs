import {periodRange,comparison} from './periods.mjs';
const empty={daily:[],clients:[],payments:[],routes:[]};
const sum=(rows,from,to,n=1)=>rows.reduce((s,r)=>s+(r[0]>=from&&r[0]<=to?r[n]:0),0);
const group=(rows,key,value)=>{const out=new Map();for(const row of rows){const k=key(row);out.set(k,(out.get(k)||0)+value(row));}return out;};
function checkedGroup(params,label){
 const from=params.get('from'+label),to=params.get('to'+label);periodRange('custom',to,from,to);
 let pvzs;try{pvzs=JSON.parse(params.get('pvzs'+label)||'[]');}catch{throw Error('invalid_group');}
 if(!Array.isArray(pvzs)||pvzs.length>50||pvzs.some(x=>typeof x!=='string'||x.length>200))throw Error('invalid_group');
 return {from,to,pvzs:[...new Set(pvzs)]};
}
export async function readSnapshot(kv,url){
 if(!kv)return null;
 const pointer=await kv.get('current','json');if(!pointer?.valid)return null;
 const prefix='v/'+pointer.version+'/',get=key=>kv.get(prefix+key,'json'),m=await get('manifest');if(!m)return null;
 const path=url.pathname,p=url.searchParams,mode={readMode:'snapshot',snapshotGeneratedAt:m.generatedAt};
 if(path==='/api/history'){
  const before=p.get('before');if(before&&!/^\d{4}-\d\d-\d\dT[\d:.]+Z\|[\da-f-]{36}$/.test(before))throw Error('invalid_cursor');
  const [date,id]=before?before.split('|'):['9999',''];const items=m.history.filter(r=>r.created_at<date||r.created_at===date&&r.id<id).slice(0,50),last=items.at(-1);
  return {items,nextCursor:items.length===50?last.created_at+'|'+last.id:null,...mode};
 }
 if(path==='/api/dashboard'){
  const from=p.get('from')||'2000-01-01',to=p.get('to')||'2100-12-31';if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('invalid_date_range');
  const root=await get('root');if(!root)return null;const rows=new Map();for(const r of root.daily)if(r.business_date>=from&&r.business_date<=to){const key=JSON.stringify([r.source_kind,r.pvz]);const v=rows.get(key)||{source_kind:r.source_kind,pvz:r.pvz,count:0,fee_minor:0,cod_minor:0};v.count+=r.record_count;v.fee_minor+=r.fee_minor;v.cod_minor+=r.cod_minor;rows.set(key,v);}
  return {rows:[...rows.values()].sort((a,b)=>a.pvz.localeCompare(b.pvz)),lastUpload:root.lastUpload,coverage:root.coverage,...mode};
 }
 if(path==='/api/dispatch/compare'){
  const a=checkedGroup(p,'A'),b=checkedGroup(p,'B'),root=await get('root');if(!root)return null;
  const total=g=>{const rows=root.daily.filter(r=>r.source_kind==='dispatch'&&r.business_date>=g.from&&r.business_date<=g.to&&(!g.pvzs.length||g.pvzs.includes(r.pvz)));return {...g,count:rows.reduce((s,r)=>s+r.record_count,0),amount:rows.reduce((s,r)=>s+r.fee_minor,0),covered:g.from>=m.coverage.minDate&&g.to<=m.coverage.maxDate};};
  const A=total(a),B=total(b);return {A,B,coverage:m.coverage,growth:{count:comparison(A.count,B.count,A.covered&&B.covered),amount:comparison(A.amount,B.amount,A.covered&&B.covered)},...mode};
 }
 if(path==='/api/dispatch/ids'){
  const from=p.get('from'),to=p.get('to');periodRange('custom',to,from,to);
  const province=p.get('province'),pvz=p.has('pvz')?p.get('pvz'):null,district=p.get('district'),cursor=p.get('after')||'';
  if(!province||province.length>200||pvz!==null&&pvz.length>200||district&&district.length>200||cursor.length>128)throw Error('invalid_filter');
  if(p.has('revision')&&p.get('revision')!==String(m.revisions.dispatch))throw Error('invalid_data_changed');
  const r=m.provinces.indexOf(province),w=pvz===null?null:m.pvzs.indexOf(pvz),d=district?m.districts.indexOf(district):null,ids=[];
  if(r<0||w===-1||d===-1)return {ids,nextCursor:null,revision:m.revisions.dispatch};
  for(const block of m.idBlocks[r]||[]){
   if(block.max<=cursor)continue;const rows=await get(block.key);if(!rows)return null;
   for(const row of rows)if(row[0]>cursor&&row[1]>=from&&row[1]<=to&&(w===null||row[2]===w)&&(d===null||row[3]===d)){ids.push(row[0]);if(ids.length===201)break;}
   if(ids.length===201)break;
  }
  return {ids:ids.slice(0,200),nextCursor:ids.length>200?ids[199]:null,revision:m.revisions.dispatch};
 }
 if(path!=='/api/dispatch')return null;
 const pvz=p.has('pvz')?p.get('pvz'):null,province=p.get('province')||null;if(pvz!==null&&pvz.length>200||province&&province.length>200)throw Error('invalid_filter');
 const wi=pvz===null?-1:m.pvzs.indexOf(pvz),valid=pvz===null||wi>=0;
 const data=valid?await get('scope/'+(wi+1)):empty;if(!data)return null;
 const kind=p.get('period')||'all',anchor=p.get('anchor')||m.coverage.maxDate;
 const range=periodRange(kind,anchor,p.get('from'),p.get('to')),from=range.from||m.coverage.minDate,to=range.to||m.coverage.maxDate;
 let previousFrom=range.previousFrom||from,previousTo=range.previousTo||to;
 const total={count:sum(data.daily,from,to),amount:sum(data.daily,from,to,2)},previous={count:sum(data.daily,previousFrom,previousTo),amount:sum(data.daily,previousFrom,previousTo,2)};
 let fallback=false;if(kind==='day'&&previous.count===0){const last=data.daily.filter(r=>r[0]<from&&r[1]>0).at(-1);if(last){previousFrom=previousTo=last[0];range.previousFrom=range.previousTo=last[0];Object.assign(previous,{count:last[1],amount:last[2]});fallback=true;}}
 const available=kind!=='all'&&from>=m.coverage.minDate&&to<=m.coverage.maxDate&&previousFrom>=m.coverage.minDate&&previousTo<=m.coverage.maxDate;
 const clients=[...group(data.clients.filter(r=>r[0]>=from&&r[0]<=to),r=>r[1],r=>r[2])].map(([category,count])=>({category,count}));
 const payments=new Map();for(const r of data.payments)if(r[0]>=from&&r[0]<=to){const v=payments.get(r[1])||{category:r[1],count:0,amount:0};v.count+=r[2];v.amount+=r[3];payments.set(r[1],v);}
 const destinations=[...group(data.routes.filter(r=>r[0]>=from&&r[0]<=to),r=>r[1]+'|'+r[2],r=>r[3])].map(([key,count])=>{const [w,r]=key.split('|').map(Number);return {pvz:m.pvzs[w],province:m.provinces[r],count};}).sort((a,b)=>b.count-a.count||a.pvz.localeCompare(b.pvz)||a.province.localeCompare(b.province));
 let districts=[];const ri=m.provinces.indexOf(province);if(province&&ri>=0){const rows=await get('districts/'+ri);if(!rows)return null;districts=[...group(rows.filter(r=>r[0]>=from&&r[0]<=to&&(pvz===null||r[1]===wi)),r=>r[2],r=>r[3])].map(([d,count])=>({district:m.districts[d],count})).sort((a,b)=>b.count-a.count||a.district.localeCompare(b.district));}
 return {coverage:m.coverage,period:{kind,anchor,from,to,previousFrom:range.previousFrom,previousTo:range.previousTo,comparisonAvailable:available,fallback},total,previous,growth:{count:comparison(total.count,previous.count,available),amount:comparison(total.amount,previous.amount,available)},clients,payments:[...payments.values()],destinations,series:data.daily.map(r=>({date:r[0],count:r[1],amount:r[2]})),pvzs:m.pvzs,districts,...mode};
}
