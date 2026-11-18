CREATE TABLE data_updates (
 source_kind TEXT PRIMARY KEY NOT NULL,
 updated_at TEXT NOT NULL
);
-- Keep aggregates consistent within the same transaction as a PVZ reassignment.
CREATE TRIGGER dispatch_pvz_reassignment AFTER UPDATE OF pvz ON operational_records
WHEN NEW.source_kind='dispatch' AND coalesce(OLD.pvz,'')<>coalesce(NEW.pvz,'')
BEGIN
 UPDATE daily_totals SET record_count=record_count-1,fee_minor=fee_minor-OLD.fee_minor,cod_minor=cod_minor-OLD.cod_minor
 WHERE source_kind='dispatch' AND business_date=OLD.business_date AND pvz=coalesce(OLD.pvz,'');
 DELETE FROM daily_totals WHERE source_kind='dispatch' AND business_date=OLD.business_date AND pvz=coalesce(OLD.pvz,'') AND record_count=0;
 INSERT INTO daily_totals VALUES('dispatch',NEW.business_date,coalesce(NEW.pvz,''),1,NEW.fee_minor,NEW.cod_minor)
 ON CONFLICT(source_kind,business_date,pvz) DO UPDATE SET record_count=record_count+1,fee_minor=fee_minor+NEW.fee_minor,cod_minor=cod_minor+NEW.cod_minor;
 UPDATE dispatch_cube SET record_count=record_count-1,fee_minor=fee_minor-OLD.fee_minor
 WHERE business_date=OLD.business_date AND pvz=coalesce(OLD.pvz,'') AND client_type=OLD.client_type AND payment_type=OLD.payment_type
 AND recipient_province=OLD.recipient_province AND recipient_district=OLD.recipient_district;
 DELETE FROM dispatch_cube WHERE business_date=OLD.business_date AND pvz=coalesce(OLD.pvz,'') AND client_type=OLD.client_type AND payment_type=OLD.payment_type
 AND recipient_province=OLD.recipient_province AND recipient_district=OLD.recipient_district AND record_count=0;
 INSERT INTO dispatch_cube VALUES(NEW.business_date,coalesce(NEW.pvz,''),NEW.client_type,NEW.payment_type,NEW.recipient_province,NEW.recipient_district,1,NEW.fee_minor)
 ON CONFLICT(business_date,pvz,client_type,payment_type,recipient_province,recipient_district)
 DO UPDATE SET record_count=record_count+1,fee_minor=fee_minor+NEW.fee_minor;
 UPDATE source_revision SET revision=revision+1 WHERE source_kind='dispatch';
 INSERT INTO data_updates VALUES('dispatch',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 ON CONFLICT(source_kind) DO UPDATE SET updated_at=excluded.updated_at;
END;
