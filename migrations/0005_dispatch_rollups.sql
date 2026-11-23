-- Apply in migration staging first. Existing live D1 stays on the prior schema.
CREATE TABLE dispatch_clients_daily (
 pvz TEXT NOT NULL,business_date TEXT NOT NULL,category TEXT NOT NULL,
 record_count INTEGER NOT NULL,PRIMARY KEY(pvz,business_date,category)
) WITHOUT ROWID;
CREATE TABLE dispatch_payments_daily (
 pvz TEXT NOT NULL,business_date TEXT NOT NULL,category TEXT NOT NULL,
 record_count INTEGER NOT NULL,fee_minor INTEGER NOT NULL,
 PRIMARY KEY(pvz,business_date,category)
) WITHOUT ROWID;
CREATE TABLE dispatch_routes_daily (
 pvz TEXT NOT NULL,business_date TEXT NOT NULL,province TEXT NOT NULL,
 record_count INTEGER NOT NULL,PRIMARY KEY(pvz,business_date,province)
) WITHOUT ROWID;
INSERT INTO dispatch_clients_daily SELECT pvz,business_date,client_type,sum(record_count)
 FROM dispatch_cube GROUP BY pvz,business_date,client_type;
INSERT INTO dispatch_payments_daily SELECT pvz,business_date,payment_type,sum(record_count),sum(fee_minor)
 FROM dispatch_cube GROUP BY pvz,business_date,payment_type;
INSERT INTO dispatch_routes_daily SELECT pvz,business_date,recipient_province,sum(record_count)
 FROM dispatch_cube GROUP BY pvz,business_date,recipient_province;
CREATE TRIGGER dispatch_rollup_reassignment AFTER UPDATE OF pvz ON operational_records
WHEN NEW.source_kind='dispatch' AND coalesce(OLD.pvz,'')<>coalesce(NEW.pvz,'')
BEGIN
 UPDATE dispatch_clients_daily SET record_count=record_count-1 WHERE pvz=coalesce(OLD.pvz,'') AND business_date=OLD.business_date AND category=OLD.client_type;
 DELETE FROM dispatch_clients_daily WHERE pvz=coalesce(OLD.pvz,'') AND business_date=OLD.business_date AND category=OLD.client_type AND record_count=0;
 INSERT INTO dispatch_clients_daily VALUES(coalesce(NEW.pvz,''),NEW.business_date,NEW.client_type,1)
 ON CONFLICT(pvz,business_date,category) DO UPDATE SET record_count=record_count+1;
 UPDATE dispatch_payments_daily SET record_count=record_count-1,fee_minor=fee_minor-OLD.fee_minor WHERE pvz=coalesce(OLD.pvz,'') AND business_date=OLD.business_date AND category=OLD.payment_type;
 DELETE FROM dispatch_payments_daily WHERE pvz=coalesce(OLD.pvz,'') AND business_date=OLD.business_date AND category=OLD.payment_type AND record_count=0;
 INSERT INTO dispatch_payments_daily VALUES(coalesce(NEW.pvz,''),NEW.business_date,NEW.payment_type,1,NEW.fee_minor)
 ON CONFLICT(pvz,business_date,category) DO UPDATE SET record_count=record_count+1,fee_minor=fee_minor+NEW.fee_minor;
 UPDATE dispatch_routes_daily SET record_count=record_count-1 WHERE pvz=coalesce(OLD.pvz,'') AND business_date=OLD.business_date AND province=OLD.recipient_province;
 DELETE FROM dispatch_routes_daily WHERE pvz=coalesce(OLD.pvz,'') AND business_date=OLD.business_date AND province=OLD.recipient_province AND record_count=0;
 INSERT INTO dispatch_routes_daily VALUES(coalesce(NEW.pvz,''),NEW.business_date,NEW.recipient_province,1)
 ON CONFLICT(pvz,business_date,province) DO UPDATE SET record_count=record_count+1;
END;
