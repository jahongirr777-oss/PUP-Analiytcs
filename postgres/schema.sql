-- PostgreSQL 16+. D1 is untouched; active generations make replacement atomic.
CREATE TABLE IF NOT EXISTS pg_schema_version(version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS source_revision (
 source_kind text PRIMARY KEY CHECK(source_kind IN ('dispatch','delivery')),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
 updated_at text
);
INSERT INTO source_revision(source_kind) VALUES('dispatch'),('delivery') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS upload_history (
 id uuid PRIMARY KEY,source_kind text NOT NULL REFERENCES source_revision(source_kind),
 mode text NOT NULL CHECK(mode IN ('add','replace')),
 state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','publishing','complete','cancelled','failed')),
 token_hash text NOT NULL,base_revision bigint NOT NULL,expected_rows integer NOT NULL CHECK(expected_rows BETWEEN 1 AND 2000000),
 received_rows integer NOT NULL DEFAULT 0,received_chunks integer NOT NULL DEFAULT 0,applied_rows integer NOT NULL DEFAULT 0,
 created_at text NOT NULL DEFAULT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 completed_at text,expires_at bigint NOT NULL,error_code text,
 CHECK(received_rows BETWEEN 0 AND expected_rows)
);
CREATE INDEX IF NOT EXISTS upload_history_cursor ON upload_history(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS upload_history_queue ON upload_history(state,created_at);
CREATE TABLE IF NOT EXISTS upload_chunks(
 upload_id uuid NOT NULL REFERENCES upload_history(id) ON DELETE CASCADE,seq integer NOT NULL CHECK(seq>=0),digest text NOT NULL,
 PRIMARY KEY(upload_id,seq)
);
CREATE TABLE IF NOT EXISTS import_records(
 upload_id uuid NOT NULL REFERENCES upload_history(id) ON DELETE CASCADE,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
 business_date text NOT NULL CHECK(business_date ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$|^2100-[0-9]{2}-[0-9]{2}$'),
 status text NOT NULL,pvz text,fee_minor bigint NOT NULL CHECK(fee_minor>=0),cod_minor bigint NOT NULL CHECK(cod_minor>=0),
 client_type text NOT NULL,payment_type text NOT NULL,recipient_district text NOT NULL,recipient_province text NOT NULL,
 PRIMARY KEY(upload_id,id)
);
CREATE TABLE IF NOT EXISTS records_store(
 generation_id uuid NOT NULL,source_kind text NOT NULL CHECK(source_kind IN ('dispatch','delivery')),
 id text NOT NULL,business_date text NOT NULL,status text NOT NULL,pvz text,
 fee_minor bigint NOT NULL CHECK(fee_minor>=0),cod_minor bigint NOT NULL CHECK(cod_minor>=0),
 client_type text NOT NULL,payment_type text NOT NULL,recipient_district text NOT NULL,recipient_province text NOT NULL,
 PRIMARY KEY(generation_id,source_kind,id)
);
-- Filtered keyset ID pages; never transfer a full table to the browser.
CREATE INDEX IF NOT EXISTS records_route_ids ON records_store(generation_id,source_kind,recipient_province,id) INCLUDE(business_date,pvz,recipient_district);
CREATE INDEX IF NOT EXISTS records_pvz_route_ids ON records_store(generation_id,source_kind,pvz,recipient_province,id) INCLUDE(business_date,recipient_district);
CREATE TABLE IF NOT EXISTS daily_totals_store(
 generation_id uuid NOT NULL,source_kind text NOT NULL,business_date text NOT NULL,pvz text NOT NULL,
 record_count bigint NOT NULL,fee_minor bigint NOT NULL,cod_minor bigint NOT NULL,
 PRIMARY KEY(generation_id,source_kind,business_date,pvz)
);
CREATE TABLE IF NOT EXISTS dispatch_cube_store(
 generation_id uuid NOT NULL,business_date text NOT NULL,pvz text NOT NULL,client_type text NOT NULL,payment_type text NOT NULL,
 recipient_province text NOT NULL,recipient_district text NOT NULL,record_count bigint NOT NULL,fee_minor bigint NOT NULL,
 PRIMARY KEY(generation_id,business_date,pvz,client_type,payment_type,recipient_province,recipient_district)
);
CREATE TABLE IF NOT EXISTS dispatch_clients_daily_store(
 generation_id uuid NOT NULL,pvz text NOT NULL,business_date text NOT NULL,category text NOT NULL,record_count bigint NOT NULL,
 PRIMARY KEY(generation_id,pvz,business_date,category)
);
CREATE TABLE IF NOT EXISTS dispatch_payments_daily_store(
 generation_id uuid NOT NULL,pvz text NOT NULL,business_date text NOT NULL,category text NOT NULL,record_count bigint NOT NULL,fee_minor bigint NOT NULL,
 PRIMARY KEY(generation_id,pvz,business_date,category)
);
CREATE TABLE IF NOT EXISTS dispatch_routes_daily_store(
 generation_id uuid NOT NULL,pvz text NOT NULL,business_date text NOT NULL,province text NOT NULL,record_count bigint NOT NULL,
 PRIMARY KEY(generation_id,pvz,business_date,province)
);
CREATE OR REPLACE VIEW operational_records AS
 SELECT r.source_kind,r.id,r.business_date,r.status,r.pvz,r.fee_minor,r.cod_minor,r.client_type,r.payment_type,r.recipient_district,r.recipient_province
 FROM records_store r JOIN source_revision s ON s.source_kind=r.source_kind AND s.generation_id=r.generation_id;
CREATE OR REPLACE VIEW daily_totals AS
 SELECT r.source_kind,r.business_date,r.pvz,r.record_count,r.fee_minor,r.cod_minor FROM daily_totals_store r
 JOIN source_revision s ON s.source_kind=r.source_kind AND s.generation_id=r.generation_id;
CREATE OR REPLACE VIEW dispatch_cube AS
 SELECT r.business_date,r.pvz,r.client_type,r.payment_type,r.recipient_province,r.recipient_district,r.record_count,r.fee_minor
 FROM dispatch_cube_store r JOIN source_revision s ON s.source_kind='dispatch' AND s.generation_id=r.generation_id;
CREATE OR REPLACE VIEW dispatch_clients_daily AS
 SELECT r.pvz,r.business_date,r.category,r.record_count FROM dispatch_clients_daily_store r
 JOIN source_revision s ON s.source_kind='dispatch' AND s.generation_id=r.generation_id;
CREATE OR REPLACE VIEW dispatch_payments_daily AS
 SELECT r.pvz,r.business_date,r.category,r.record_count,r.fee_minor FROM dispatch_payments_daily_store r
 JOIN source_revision s ON s.source_kind='dispatch' AND s.generation_id=r.generation_id;
CREATE OR REPLACE VIEW dispatch_routes_daily AS
 SELECT r.pvz,r.business_date,r.province,r.record_count FROM dispatch_routes_daily_store r
 JOIN source_revision s ON s.source_kind='dispatch' AND s.generation_id=r.generation_id;
CREATE OR REPLACE VIEW data_updates AS SELECT source_kind,updated_at FROM source_revision;
INSERT INTO pg_schema_version VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS retired_generations(generation_id uuid PRIMARY KEY,retired_at bigint NOT NULL);
