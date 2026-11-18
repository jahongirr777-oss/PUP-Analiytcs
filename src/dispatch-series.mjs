import {periodRange,addDays,comparison} from '../server/periods.mjs';
export function buildSeries(series,from,to,group,coverage){
 if(!from||!to)return [];
 const daily=new Map(series.map(x=>[x.date,x]));
 const total=(a,b)=>{let count=0,amount=0;for(const row of series)if(row.date>=a&&row.date<=b){count+=row.count;amount+=row.amount;}return {count,amount};};
 const rows=[];let start=from,guard=0;
 while(start<=to&&guard++<4000){
  let end=start;
  while(end<to&&periodRange(group,addDays(end,1)).from===periodRange(group,start).from)end=addDays(end,1);
  const calendar=periodRange(group,end);
  const range=calendar.from===start?calendar:periodRange('custom',end,start,end);
  const current=group==='day'?(daily.get(start)||{count:0,amount:0}):total(start,end);
  let previous=total(range.previousFrom,range.previousTo),fallback=false;
  if(group==='day'&&previous.count===0){const latest=series.filter(r=>r.date<start&&r.count>0).at(-1);if(latest){previous={count:latest.count,amount:latest.amount};range.previousFrom=range.previousTo=latest.date;fallback=true;}}
  const available=!!coverage.minDate&&start>=coverage.minDate&&end<=coverage.maxDate&&range.previousFrom>=coverage.minDate&&range.previousTo<=coverage.maxDate;
  rows.push({from:start,to:end,...current,growth:comparison(current.count,previous.count,available),amountGrowth:comparison(current.amount,previous.amount,available),previousFrom:range.previousFrom,previousTo:range.previousTo,fallback});
  start=addDays(end,1);
 }
 return rows;
}
