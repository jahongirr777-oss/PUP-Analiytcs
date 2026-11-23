// A temporary table contains only rows actually inserted by this import.
// Additive imports update summaries from this delta instead of scanning 10m IDs.
export async function applyRollups(client,generation,source,table='applied_import'){
 if(!['applied_import','migration_records'].includes(table))throw Error('invalid_internal_table');
 const grouped=[
  ['daily_totals_store','source_kind,business_date,pvz','source_kind,business_date,coalesce(pvz,\'\')','count(*),sum(fee_minor),sum(cod_minor)',['record_count','fee_minor','cod_minor']],
 ];
 if(source==='dispatch')grouped.push(
  ['dispatch_cube_store','business_date,pvz,client_type,payment_type,recipient_province,recipient_district',"business_date,coalesce(pvz,''),client_type,payment_type,recipient_province,recipient_district",'count(*),sum(fee_minor)',['record_count','fee_minor']],
  ['dispatch_clients_daily_store','pvz,business_date,category',"coalesce(pvz,''),business_date,client_type",'count(*)',['record_count']],
  ['dispatch_payments_daily_store','pvz,business_date,category',"coalesce(pvz,''),business_date,payment_type",'count(*),sum(fee_minor)',['record_count','fee_minor']],
  ['dispatch_routes_daily_store','pvz,business_date,province',"coalesce(pvz,''),business_date,recipient_province",'count(*)',['record_count']],
 );
 for(const [name,keys,expressions,aggregates,totals] of grouped){
  await client.query(`INSERT INTO ${name}(generation_id,${keys},${totals.join(',')})
   SELECT $1::uuid,${expressions},${aggregates} FROM ${table} GROUP BY ${expressions}
   ON CONFLICT(generation_id,${keys}) DO UPDATE SET ${totals.map(k=>`${k}=${name}.${k}+EXCLUDED.${k}`).join(',')}`,[generation]);
 }
}
