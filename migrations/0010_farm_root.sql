-- Preserve existing subdomain sites and all publication snapshots.
CREATE TABLE farm_sites_new (
 id TEXT PRIMARY KEY, domain_id TEXT NOT NULL REFERENCES farm_domains(id) ON DELETE RESTRICT,
 subdomain TEXT, publish_mode TEXT NOT NULL DEFAULT 'subdomain' CHECK(publish_mode IN ('root','subdomain')), company TEXT NOT NULL, cnpj TEXT NOT NULL, data TEXT NOT NULL,
 theme TEXT NOT NULL, head TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','provisioning','published','error')),
 published_data TEXT, published_theme TEXT, published_head TEXT, published_version INTEGER,
 cloudflare_domain_id TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT '',
 pending_address TEXT,
 operation_id TEXT, operation_until INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), published_at TEXT,
 CHECK((publish_mode='root' AND subdomain IS NULL) OR (publish_mode='subdomain' AND subdomain IS NOT NULL AND length(subdomain)>0)),
 UNIQUE(domain_id,subdomain)
);

INSERT INTO farm_sites_new(id,domain_id,subdomain,company,cnpj,data,theme,head,version,status,published_data,published_theme,published_head,published_version,cloudflare_domain_id,last_error,pending_address,operation_id,operation_until,created_at,updated_at,published_at) SELECT id,domain_id,subdomain,company,cnpj,data,theme,head,version,status,published_data,published_theme,published_head,published_version,cloudflare_domain_id,last_error,pending_address,operation_id,operation_until,created_at,updated_at,published_at FROM farm_sites;
DROP TABLE farm_sites;
ALTER TABLE farm_sites_new RENAME TO farm_sites;
CREATE INDEX farm_sites_domain ON farm_sites(domain_id);
CREATE UNIQUE INDEX farm_root_published ON farm_sites(domain_id) WHERE publish_mode='root' AND published_data IS NOT NULL;
CREATE TRIGGER farm_capacity_insert BEFORE INSERT ON farm_sites BEGIN
 SELECT RAISE(ABORT,'FARM_DOMAIN_INACTIVE') WHERE NOT EXISTS(SELECT 1 FROM farm_domains WHERE id=NEW.domain_id AND active=1 AND zone_status='active');
 SELECT RAISE(ABORT,'FARM_CAPACITY') WHERE (SELECT site_limit FROM farm_domains WHERE id=NEW.domain_id) IS NOT NULL AND (SELECT COUNT(*) FROM farm_sites WHERE domain_id=NEW.domain_id)>=(SELECT site_limit FROM farm_domains WHERE id=NEW.domain_id);
END;
CREATE TRIGGER farm_capacity_move BEFORE UPDATE OF domain_id ON farm_sites WHEN OLD.domain_id<>NEW.domain_id BEGIN
 SELECT RAISE(ABORT,'FARM_DOMAIN_INACTIVE') WHERE NOT EXISTS(SELECT 1 FROM farm_domains WHERE id=NEW.domain_id AND active=1 AND zone_status='active');
 SELECT RAISE(ABORT,'FARM_CAPACITY') WHERE (SELECT site_limit FROM farm_domains WHERE id=NEW.domain_id) IS NOT NULL AND (SELECT COUNT(*) FROM farm_sites WHERE domain_id=NEW.domain_id)>=(SELECT site_limit FROM farm_domains WHERE id=NEW.domain_id);
END;


ALTER TABLE farm_domains ADD COLUMN operation_id TEXT;
ALTER TABLE farm_domains ADD COLUMN operation_until INTEGER NOT NULL DEFAULT 0;

