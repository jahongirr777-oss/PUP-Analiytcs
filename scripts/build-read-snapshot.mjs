// Operator recovery helper. Input/export and KV bulk files MUST stay outside Git.
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Provide private export and private output paths');
const db=new DatabaseSync(':memory:');db.exec(await readFile(input,'utf8'));
const all=sql=>db.prepare(sql).all(),one=sql=>db.prepare(sql).get();
const pvzs=all("SELECT DISTINCT pvz FROM daily_totals WHERE source_kind='dispatch' ORDER BY pvz").map(r=>r.pvz);
const provinces=all('SELECT DISTINCT recipient_province p FROM dispatch_cube ORDER BY p').map(r=>r.p);
const districts=all('SELECT DISTINCT recipient_district d FROM dispatch_cube ORDER BY d').map(r=>r.d);
const pi=new Map(pvzs.map((v,i)=>[v,i])),ri=new Map(provinces.map((v,i)=>[v,i])),di=new Map(districts.map((v,i)=>[v,i]));
const version=randomUUID(),entries=[],prefix='v/'+version+'/';
const put=(key,value)=>entries.push({key:prefix+key,value:JSON.stringify(value)});
const coverage=one(`SELECT min(business_date) minDate,max(business_date) maxDate,
 (SELECT max(value) FROM(SELECT max(completed_at) value FROM upload_history WHERE source_kind='dispatch' AND state='complete' UNION ALL SELECT updated_at FROM data_updates WHERE source_kind='dispatch')) updatedAt
 FROM daily_totals WHERE source_kind='dispatch'`);
const revisions=Object.fromEntries(all('SELECT * FROM source_revision').map(r=>[r.source_kind,r.revision]));
const history=all('SELECT id,source_kind,mode,state,expected_rows,received_rows,applied_rows,created_at,completed_at FROM upload_history ORDER BY created_at DESC,id DESC');
const root={daily:all('SELECT * FROM daily_totals'),coverage:one('SELECT min(business_date) minDate,max(business_date) maxDate FROM daily_totals'),lastUpload:one("SELECT max(value) value FROM(SELECT max(completed_at) value FROM upload_history WHERE state='complete' UNION ALL SELECT updated_at FROM data_updates)").value};
put('root',root);
for(let index=-1;index<pvzs.length;index++){
 const scope=index<0?'1':"pvz='"+pvzs[index].replace(/'/g,"''")+"'";
 const daily=all(`SELECT business_date,sum(record_count) n,sum(fee_minor) f FROM daily_totals WHERE source_kind='dispatch' AND ${scope} GROUP BY business_date ORDER BY business_date`).map(r=>[r.business_date,r.n,r.f]);
 const clients=all(`SELECT business_date,client_type,sum(record_count) n FROM dispatch_cube WHERE ${scope} GROUP BY business_date,client_type`).map(r=>[r.business_date,r.client_type,r.n]);
 const payments=all(`SELECT business_date,payment_type,sum(record_count) n,sum(fee_minor) f FROM dispatch_cube WHERE ${scope} GROUP BY business_date,payment_type`).map(r=>[r.business_date,r.payment_type,r.n,r.f]);
 const routes=all(`SELECT business_date,pvz,recipient_province,sum(record_count) n FROM dispatch_cube WHERE ${scope} GROUP BY business_date,pvz,recipient_province`).map(r=>[r.business_date,pi.get(r.pvz),ri.get(r.recipient_province),r.n]);
 put('scope/'+(index+1),{daily,clients,payments,routes});
}
const idBlocks=[];
for(let index=0;index<provinces.length;index++){
 const province=provinces[index];
 const dims=db.prepare('SELECT business_date,pvz,recipient_district,sum(record_count) n FROM dispatch_cube WHERE recipient_province=? GROUP BY business_date,pvz,recipient_district').all(province).map(r=>[r.business_date,pi.get(r.pvz),di.get(r.recipient_district),r.n]);
 put('districts/'+index,dims);
 const ids=db.prepare("SELECT id,business_date,pvz,recipient_district FROM operational_records WHERE source_kind='dispatch' AND recipient_province=? ORDER BY id").all(province);
 const blocks=[];for(let offset=0;offset<ids.length;offset+=1000){const rows=ids.slice(offset,offset+1000).map(r=>[r.id,r.business_date,pi.get(r.pvz||''),di.get(r.recipient_district)]);const key='ids/'+index+'/'+offset;put(key,rows);blocks.push({key,max:rows.at(-1)[0]});}idBlocks.push(blocks);
}
const manifest={version,generatedAt:new Date().toISOString(),coverage,pvzs,provinces,districts,revisions,history,idBlocks};
put('manifest',manifest);entries.push({key:'current',value:JSON.stringify({version,valid:true})});
await writeFile(output,JSON.stringify(entries),{mode:0o600});
console.log(JSON.stringify({keys:entries.length,bytes:entries.reduce((n,r)=>n+Buffer.byteLength(r.value),0),maxValueBytes:Math.max(...entries.map(r=>Buffer.byteLength(r.value))),dispatch:one("SELECT count(*) n FROM operational_records WHERE source_kind='dispatch'").n,delivery:one("SELECT count(*) n FROM operational_records WHERE source_kind='delivery'").n}));db.close();
