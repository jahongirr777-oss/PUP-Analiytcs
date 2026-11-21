CREATE TABLE upload_history (
  id TEXT PRIMARY KEY NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('dispatch','delivery')),
  mode TEXT NOT NULL CHECK(mode IN ('add','replace')),
  state TEXT NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','publishing','complete','cancelled')),
  token_hash TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  expected_rows INTEGER NOT NULL CHECK(expected_rows BETWEEN 1 AND 50000),
  received_rows INTEGER NOT NULL DEFAULT 0,
  received_chunks INTEGER NOT NULL DEFAULT 0,
  applied_rows INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT,
  expires_at INTEGER NOT NULL
);
CREATE TABLE source_revision (
  source_kind TEXT PRIMARY KEY CHECK(source_kind IN ('dispatch','delivery')),
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO source_revision VALUES ('dispatch',0),('delivery',0);
CREATE TABLE upload_chunks (
  upload_id TEXT NOT NULL REFERENCES upload_history(id),
  seq INTEGER NOT NULL CHECK(seq >= 0),
  digest TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(upload_id,seq)
) WITHOUT ROWID;
CREATE TRIGGER upload_chunk_guard BEFORE INSERT ON upload_chunks
WHEN NOT EXISTS(SELECT 1 FROM upload_history
 WHERE id=NEW.upload_id AND state='uploading'
 AND NEW.seq=received_chunks AND received_rows+json_array_length(NEW.payload)<=expected_rows)
BEGIN SELECT RAISE(ABORT,'invalid_chunk_state'); END;
CREATE TRIGGER upload_chunk_count AFTER INSERT ON upload_chunks
BEGIN UPDATE upload_history SET received_chunks=received_chunks+1,
 received_rows=received_rows+json_array_length(NEW.payload) WHERE id=NEW.upload_id; END;
CREATE TABLE operational_records (
  source_kind TEXT NOT NULL CHECK(source_kind IN ('dispatch','delivery')),
  id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL,
  pvz TEXT,
  fee_minor INTEGER NOT NULL CHECK(fee_minor>=0),
  cod_minor INTEGER NOT NULL CHECK(cod_minor>=0),
  PRIMARY KEY(source_kind,id)
) WITHOUT ROWID;
CREATE TABLE daily_totals (
  source_kind TEXT NOT NULL,
  business_date TEXT NOT NULL,
  pvz TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL,
  cod_minor INTEGER NOT NULL,
  PRIMARY KEY(source_kind,business_date,pvz)
) WITHOUT ROWID;
CREATE TRIGGER upload_publish_guard BEFORE UPDATE OF state ON upload_history
WHEN NEW.state='publishing' AND (
 OLD.state<>'uploading' OR OLD.received_rows<>OLD.expected_rows OR
 OLD.base_revision<>(SELECT revision FROM source_revision WHERE source_kind=OLD.source_kind) OR
 (SELECT count(DISTINCT json_extract(r.value,'$.id')) FROM upload_chunks c,json_each(c.payload) r WHERE c.upload_id=OLD.id)<>OLD.expected_rows
)
BEGIN SELECT RAISE(ABORT,'incomplete_duplicate_or_stale_upload'); END;
