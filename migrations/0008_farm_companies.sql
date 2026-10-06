-- Operational selections only. The Receita snapshot lives outside D1.
CREATE TABLE farm_company_selections (
 cnpj TEXT PRIMARY KEY,
 state TEXT NOT NULL DEFAULT 'unused' CHECK(state IN ('unused','reserved','used')),
 reservation_token TEXT, reserved_until INTEGER,
 site_id TEXT, snapshot TEXT NOT NULL DEFAULT '{}',
 status_code INTEGER, verified_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX farm_company_state ON farm_company_selections(state,cnpj);
CREATE INDEX farm_sites_cnpj ON farm_sites(cnpj);
ALTER TABLE farm_sites ADD COLUMN company_reservation_token TEXT;
INSERT INTO farm_company_selections(cnpj,state,site_id,snapshot)
 SELECT cnpj,'used',MIN(id),data FROM farm_sites GROUP BY cnpj;
-- Token is checked in the same transaction as site creation, preventing races.
CREATE TRIGGER farm_company_reservation BEFORE INSERT ON farm_sites
 WHEN NEW.company_reservation_token IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'FARM_RESERVATION_INVALID') WHERE NOT EXISTS (
 SELECT 1 FROM farm_company_selections WHERE cnpj=NEW.cnpj AND state='reserved'
 AND reservation_token=NEW.company_reservation_token AND status_code=2
 AND reserved_until>CAST(strftime('%s','now') AS INTEGER)*1000);
END;
CREATE TRIGGER farm_company_used_insert AFTER INSERT ON farm_sites BEGIN
 INSERT INTO farm_company_selections(cnpj,state,site_id,snapshot)
 VALUES(NEW.cnpj,'used',NEW.id,NEW.data)
 ON CONFLICT(cnpj) DO UPDATE SET state='used',site_id=NEW.id,
 reservation_token=NULL,reserved_until=NULL,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
CREATE TRIGGER farm_company_used_update AFTER UPDATE OF cnpj ON farm_sites
 WHEN NEW.cnpj<>OLD.cnpj BEGIN
 INSERT INTO farm_company_selections(cnpj,state,site_id,snapshot)
 VALUES(NEW.cnpj,'used',NEW.id,NEW.data)
 ON CONFLICT(cnpj) DO UPDATE SET state='used',site_id=NEW.id,
 reservation_token=NULL,reserved_until=NULL,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;
