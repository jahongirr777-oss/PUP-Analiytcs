// D1 batch is atomic. A failed validation or stale base revision rolls it all back.
export function publicationStatements(db,job){
  const bind=sql=>db.prepare(sql).bind(job.id);
  return [
    bind("UPDATE upload_history SET state='publishing' WHERE id=?"),
    db.prepare(`DELETE FROM operational_records WHERE source_kind=(SELECT source_kind FROM upload_history WHERE id=?)
      AND EXISTS(SELECT 1 FROM upload_history WHERE id=? AND state='publishing' AND mode='replace')`).bind(job.id,job.id),
    bind(`INSERT OR IGNORE INTO operational_records
      SELECT h.source_kind,json_extract(r.value,'$.id'),json_extract(r.value,'$.businessDate'),
      json_extract(r.value,'$.status'),json_extract(r.value,'$.pvz'),
      json_extract(r.value,'$.deliveryFeeMinor'),json_extract(r.value,'$.codMinor')
      FROM upload_history h JOIN upload_chunks c ON c.upload_id=h.id,json_each(c.payload) r
      WHERE h.id=? AND h.state='publishing'`),
    bind("UPDATE upload_history SET applied_rows=changes() WHERE id=? AND state='publishing'"),
    bind("DELETE FROM daily_totals WHERE source_kind=(SELECT source_kind FROM upload_history WHERE id=?)"),
    bind(`INSERT INTO daily_totals SELECT source_kind,business_date,coalesce(pvz,''),count(*),sum(fee_minor),sum(cod_minor)
      FROM operational_records WHERE source_kind=(SELECT source_kind FROM upload_history WHERE id=?)
      GROUP BY source_kind,business_date,coalesce(pvz,'')`),
    bind("UPDATE source_revision SET revision=revision+1 WHERE source_kind=(SELECT source_kind FROM upload_history WHERE id=?)"),
    bind("UPDATE upload_history SET state='complete',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='publishing'"),
    bind('DELETE FROM upload_chunks WHERE upload_id=?'),
  ];
}
