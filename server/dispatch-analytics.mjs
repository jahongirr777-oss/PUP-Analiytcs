import {periodRange,comparison} from './periods.mjs';
export async function dispatchAnalytics(db,params){
 const meta=await db.prepare(`SELECT min(business_date) minDate,max(business_date) maxDate,
  (SELECT max(value) FROM (SELECT max(completed_at) value FROM upload_history WHERE source_kind='dispatch' AND state='complete'
    UNION ALL SELECT updated_at FROM data_updates WHERE source_kind='dispatch')) updatedAt
  FROM daily_totals WHERE source_kind='dispatch'`).first();
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const kind=params.get('period')||'all',anchor=params.get('anchor')||meta.maxDate||today;
 const period=periodRange(kind,anchor,params.get('from'),params.get('to'));
 const from=period.from||meta.minDate||anchor,to=period.to||meta.maxDate||anchor;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw Error('invalid_range');
 let previousFrom=period.previousFrom||from,previousTo=period.previousTo||to;
 const pvz=params.has('pvz')?params.get('pvz'):null,province=params.get('province')||null;
 if(pvz!==null&&pvz.length>200||province&&province.length>200)throw Error('invalid_filter');
 const scope='(? IS NULL OR pvz=?)';
 const current=`business_date BETWEEN ? AND ? AND ${scope}`;
 const query=(sql,values)=>db.prepare(sql).bind(...values);
 const values=[from,to,pvz,pvz],previousValues=[previousFrom,previousTo,pvz,pvz];
 const batches=await db.batch([
  query(`SELECT coalesce(sum(record_count),0) count,coalesce(sum(fee_minor),0) amount FROM daily_totals WHERE source_kind='dispatch' AND ${current}`,values),
  query(`SELECT coalesce(sum(record_count),0) count,coalesce(sum(fee_minor),0) amount FROM daily_totals WHERE source_kind='dispatch' AND ${current}`,previousValues),
  query(`SELECT client_type category,sum(record_count) count FROM dispatch_cube WHERE ${current} GROUP BY client_type`,values),
  query(`SELECT payment_type category,sum(record_count) count,sum(fee_minor) amount FROM dispatch_cube WHERE ${current} GROUP BY payment_type`,values),
  query(`SELECT pvz,recipient_province province,sum(record_count) count FROM dispatch_cube WHERE ${current} GROUP BY pvz,recipient_province ORDER BY count DESC,pvz,province`,values),
  query(`SELECT business_date date,sum(record_count) count,sum(fee_minor) amount FROM daily_totals
    WHERE source_kind='dispatch' AND ${scope} GROUP BY business_date ORDER BY business_date`,[pvz,pvz]),
  db.prepare("SELECT DISTINCT pvz FROM daily_totals WHERE source_kind='dispatch' ORDER BY pvz"),
  province?query(`SELECT recipient_district district,sum(record_count) count FROM dispatch_cube
    WHERE ${current} AND recipient_province=? GROUP BY recipient_district ORDER BY count DESC,district`,[...values,province]):db.prepare('SELECT 1 WHERE 0'),
 ]);
 const currentTotal=batches[0].results[0],previous=batches[1].results[0];
 let fallback=false;
 if(kind==='day'&&previous.count===0){
   const latest=batches[5].results.filter(r=>r.date<from&&r.count>0).at(-1);
   if(latest){previousFrom=previousTo=latest.date;Object.assign(previous,{count:latest.count,amount:latest.amount});period.previousFrom=period.previousTo=latest.date;fallback=true;}
 }
 const available=kind!=='all'&&!!meta.minDate&&from>=meta.minDate&&to<=meta.maxDate&&previousFrom>=meta.minDate&&previousTo<=meta.maxDate;
 return {coverage:meta,period:{kind,anchor,from,to,previousFrom:period.previousFrom,previousTo:period.previousTo,comparisonAvailable:available,fallback},
  total:currentTotal,previous,growth:{count:comparison(currentTotal.count,previous.count,available),amount:comparison(currentTotal.amount,previous.amount,available)},
  clients:batches[2].results,payments:batches[3].results,destinations:batches[4].results,series:batches[5].results,
  pvzs:batches[6].results.map(r=>r.pvz),districts:batches[7].results};
}
