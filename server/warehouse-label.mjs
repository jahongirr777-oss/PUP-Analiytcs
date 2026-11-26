export function warehouseLabel(raw){
 if(!raw)return 'Аниқланмаган';
 const match=/^(\d+)\s+(.+)$/.exec(raw.trim());if(!match)return raw;
 const code=match[1],known={'100':'Toshkent','101':'Sergili','106':'Bekbaraka'};
 const name=known[code]||match[2].replace(/fargo|sorting|warehouse/gi,'').replace(/bo['‘’ʻʼ]?lim(?:i)?/gi,'').replace(/\s+/g,' ').replace(/^[\s-]+|[\s-]+$/g,'').trim();
 return `${code} ${name} Warehouse`;
}
export function topWarehouseRoutes(destinations,allWarehouses=true,province=''){
 const filtered=destinations.filter(r=>!province||r.province===province);
 if(!allWarehouses)return filtered;
 const best=new Map();for(const r of filtered){const prior=best.get(r.pvz);if(!prior||r.count>prior.count||r.count===prior.count&&r.province.localeCompare(prior.province)<0)best.set(r.pvz,r);}
 return [...best.values()].sort((a,b)=>warehouseLabel(a.pvz).localeCompare(warehouseLabel(b.pvz)));
}
