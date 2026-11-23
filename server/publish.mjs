// D1 batch is atomic. A failed validation or stale base revision rolls it all back.
export function publicationStatements(db,job,options={}){
  const bind=sql=>db.prepare(sql).bind(job.id);
  const statements=[
    bind("UPDATE upload_history SET state='publishing' WHERE id=?"),
    db.prepare(`DELETE FROM operational_records WHERE source_kind=(SELECT source_kind FROM upload_history WHERE id=?)
      AND EXISTS(SELECT 1 FROM upload_history WHERE id=? AND state='publishing' AND mode='replace')`).bind(job.id,job.id),
    bind(`INSERT OR IGNORE INTO operational_records
      (source_kind,id,business_date,status,pvz,fee_minor,cod_minor,client_type,payment_type,recipient_district,recipient_province)
      SELECT h.source_kind,json_extract(r.value,'$.id'),json_extract(r.value,'$.businessDate'),
      json_extract(r.value,'$.status'),json_extract(r.value,'$.pvz'),
      json_extract(r.value,'$.deliveryFeeMinor'),json_extract(r.value,'$.codMinor'),
      coalesce(json_extract(r.value,'$.clientType'),'unknown'),coalesce(json_extract(r.value,'$.paymentType'),'unknown'),
      coalesce(json_extract(r.value,'$.recipientDistrict'),''),coalesce(json_extract(r.value,'$.recipientProvince'),'Аниқланмаган')
      FROM upload_history h JOIN upload_chunks c ON c.upload_id=h.id,json_each(c.payload) r
      WHERE h.id=? AND h.state='publishing'`),
    bind("UPDATE upload_history SET applied_rows=changes() WHERE id=? AND state='publishing'"),
    bind("DELETE FROM dispatch_cube WHERE (SELECT source_kind FROM upload_history WHERE id=?)='dispatch'"),
    bind(`INSERT INTO dispatch_cube SELECT business_date,coalesce(pvz,''),client_type,payment_type,recipient_province,recipient_district,count(*),sum(fee_minor)
      FROM operational_records WHERE source_kind='dispatch' AND (SELECT source_kind FROM upload_history WHERE id=?)='dispatch'
      GROUP BY business_date,coalesce(pvz,''),client_type,payment_type,recipient_province,recipient_district`),
    bind("DELETE FROM daily_totals WHERE source_kind=(SELECT source_kind FROM upload_history WHERE id=?)"),
    bind(`INSERT INTO daily_totals SELECT source_kind,business_date,coalesce(pvz,''),count(*),sum(fee_minor),sum(cod_minor)
      FROM operational_records WHERE source_kind=(SELECT source_kind FROM upload_history WHERE id=?)
      GROUP BY source_kind,business_date,coalesce(pvz,'')`),
    bind("UPDATE source_revision SET revision=revision+1 WHERE source_kind=(SELECT source_kind FROM upload_history WHERE id=?)"),
    bind("UPDATE upload_history SET state='complete',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='publishing'"),
    bind('DELETE FROM upload_chunks WHERE upload_id=?'),
  ];
  if(options.rollups){
    const rollups=[['dispatch_clients_daily','client_type',''],['dispatch_payments_daily','payment_type',',sum(fee_minor)'],['dispatch_routes_daily','recipient_province','']];
    const position=statements.length-3;
    statements.splice(position,0,...rollups.flatMap(([table,category,amount])=>[
      bind(`DELETE FROM ${table} WHERE (SELECT source_kind FROM upload_history WHERE id=?)='dispatch'`),
      bind(`INSERT INTO ${table} SELECT pvz,business_date,${category},sum(record_count)${amount} FROM dispatch_cube WHERE (SELECT source_kind FROM upload_history WHERE id=?)='dispatch' GROUP BY pvz,business_date,${category}`),
    ]));
  }
  return statements;
}
