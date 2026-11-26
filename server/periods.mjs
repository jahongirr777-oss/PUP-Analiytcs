const DAY=86400000;
const iso=d=>new Date(d).toISOString().slice(0,10);
const date=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('invalid_date');const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(+d)||iso(d)!==s)throw Error('invalid_date');return d;};
const add=(s,n)=>iso(+date(s)+n*DAY);
const length=(a,b)=>Math.round((+date(b)-+date(a))/DAY)+1;
function monthDate(year,month,day=1){return iso(Date.UTC(year,month,day));}
export const periodKinds=['all','day','week','decade','month','quarter','half','year','custom'];
export function periodRange(kind,anchor,from,to){
 if(!periodKinds.includes(kind))throw Error('invalid_period');
 const d=date(anchor),y=d.getUTCFullYear(),m=d.getUTCMonth(),day=d.getUTCDate();
 let start=anchor,end=anchor,previousStart,previousEnd;
 if(kind==='all')return {from:null,to:null,previousFrom:null,previousTo:null};
 if(kind==='custom'){
  date(from);date(to);if(from>to||length(from,to)>3660)throw Error('invalid_range');
  return {from,to,previousFrom:add(from,-length(from,to)),previousTo:add(from,-1)};
 }
 if(kind==='day')previousStart=add(start,-1);
 if(kind==='week'){start=add(anchor,-((d.getUTCDay()+6)%7));previousStart=add(start,-7);}
 if(kind==='decade'){
  const first=day<=10?1:day<=20?11:21;start=monthDate(y,m,first);
  previousStart=first===1?monthDate(y,m-1,21):monthDate(y,m,first-10);
  const previousLimit=add(start,-1);
  const currentLimit=first===21?monthDate(y,m+1,0):monthDate(y,m,first+9);
  previousEnd=end===currentLimit?previousLimit:add(previousStart,Math.min(length(start,end),length(previousStart,previousLimit))-1);
 }
 if(['month','quarter','half','year'].includes(kind)){
  const months={month:1,quarter:3,half:6,year:12}[kind];const first=Math.floor(m/months)*months;
  start=monthDate(y,first);previousStart=monthDate(y,first-months);
  // Match elapsed calendar months and day, clamping leap days/month lengths.
  const prevMonth=m-months;const prevLast=new Date(Date.UTC(y,prevMonth+1,0)).getUTCDate();
  previousEnd=end===monthDate(y,first+months,0)?add(start,-1):monthDate(y,prevMonth,Math.min(day,prevLast));
 }
 previousEnd??=add(previousStart,length(start,end)-1);
 return {from:start,to:end,previousFrom:previousStart,previousTo:previousEnd};
}
export function comparison(current,previous,available){
 if(!available)return {delta:null,percent:null,direction:'unavailable'};
 const delta=current-previous;
 return {delta,percent:previous===0?null:delta/previous*100,direction:delta>0?'up':delta<0?'down':'flat'};
}
export {add as addDays};
