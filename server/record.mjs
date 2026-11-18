import {provinceFor} from './regions.mjs';
const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
export function businessDate(text){
  const m=/^(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if(!m||!months[m[2]]||+m[4]>23||+m[5]>59||+m[6]>59)throw Error('invalid_date');
  const year=+m[3],month=months[m[2]],day=+m[1];
  if(year<2000||year>2100||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())throw Error('invalid_date');
  return `${year}-${String(month).padStart(2,'0')}-${m[1]}`;
}
export function normalizeRecord(row,options={}){
  if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id.trim()||row.id.length>128)throw Error('invalid_id');
  if(typeof row.status!=='string'||row.status.length>200)throw Error('invalid_status');
  if(row.pvz!==null&&(typeof row.pvz!=='string'||!row.pvz.trim()||row.pvz.length>200))throw Error('invalid_pvz');
  for(const key of ['deliveryFeeMinor','codMinor'])if(!Number.isSafeInteger(row[key])||row[key]<0||row[key]>1e12)throw Error('invalid_amount');
  // Reconstruct an allowlist: names and extra client fields never enter storage.
  const clientType=row.clientType??'unknown',paymentType=row.paymentType??'unknown',recipientDistrict=row.recipientDistrict??'';
  if(!['legal','individual','unknown'].includes(clientType)||!['corporate','recipient_cash','sender_cash','unpaid','unknown'].includes(paymentType))throw Error('invalid_category');
  if(typeof recipientDistrict!=='string'||recipientDistrict.length>200)throw Error('invalid_district');
  const assignedPvz=options.sourceKind==='dispatch'&&typeof row.clientKey==='string'&&options.clientKeys?.includes(row.clientKey)?"106 Fargo Bek-Baraka bo'limi":row.pvz;
  return {id:row.id.trim(),businessDate:businessDate(row.sourceDate),status:row.status,pvz:assignedPvz,
    deliveryFeeMinor:row.deliveryFeeMinor,codMinor:row.codMinor,clientType,paymentType,recipientDistrict,
    recipientProvince:provinceFor(recipientDistrict)};
}
