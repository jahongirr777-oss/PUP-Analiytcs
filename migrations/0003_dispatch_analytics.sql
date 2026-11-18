ALTER TABLE operational_records ADD COLUMN client_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE operational_records ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE operational_records ADD COLUMN recipient_district TEXT NOT NULL DEFAULT '';
ALTER TABLE operational_records ADD COLUMN recipient_province TEXT NOT NULL DEFAULT 'Аниқланмаган';
CREATE TABLE dispatch_cube (
  business_date TEXT NOT NULL,
  pvz TEXT NOT NULL,
  client_type TEXT NOT NULL,
  payment_type TEXT NOT NULL,
  recipient_province TEXT NOT NULL,
  recipient_district TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL,
  PRIMARY KEY(business_date,pvz,client_type,payment_type,recipient_province,recipient_district)
) WITHOUT ROWID;
-- Preserve old dispatch totals until the explicitly requested replacement succeeds.
INSERT INTO dispatch_cube
SELECT business_date,coalesce(pvz,''),'unknown','unknown','Аниқланмаган','',count(*),sum(fee_minor)
FROM operational_records WHERE source_kind='dispatch' GROUP BY business_date,coalesce(pvz,'');
