CREATE TABLE farm_domains (
 id TEXT PRIMARY KEY, hostname TEXT NOT NULL UNIQUE,
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 site_limit INTEGER CHECK(site_limit IS NULL OR site_limit >= 0),
 zone_id TEXT NOT NULL DEFAULT '', zone_status TEXT NOT NULL DEFAULT 'pending',
 nameservers TEXT NOT NULL DEFAULT '[]', last_error TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE farm_sites (
 id TEXT PRIMARY KEY, domain_id TEXT NOT NULL REFERENCES farm_domains(id) ON DELETE RESTRICT,
 subdomain TEXT NOT NULL, company TEXT NOT NULL, cnpj TEXT NOT NULL, data TEXT NOT NULL,
 theme TEXT NOT NULL, head TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','provisioning','published','error')),
 published_data TEXT, published_theme TEXT, published_head TEXT, published_version INTEGER,
 cloudflare_domain_id TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT '',
 pending_address TEXT,
 operation_id TEXT, operation_until INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), published_at TEXT,
 UNIQUE(domain_id,subdomain)
);
CREATE INDEX farm_sites_domain ON farm_sites(domain_id);
CREATE TABLE farm_deployments (
 id TEXT PRIMARY KEY, site_id TEXT, company TEXT NOT NULL, hostname TEXT NOT NULL,
 action TEXT NOT NULL, status TEXT NOT NULL, version INTEGER,
 message TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX farm_deployments_site ON farm_deployments(site_id,created_at);
CREATE TRIGGER farm_capacity_insert BEFORE INSERT ON farm_sites BEGIN
 SELECT RAISE(ABORT,'FARM_DOMAIN_INACTIVE') WHERE NOT EXISTS(SELECT 1 FROM farm_domains WHERE id=NEW.domain_id AND active=1 AND zone_status='active');
 SELECT RAISE(ABORT,'FARM_CAPACITY') WHERE (SELECT site_limit FROM farm_domains WHERE id=NEW.domain_id) IS NOT NULL AND (SELECT COUNT(*) FROM farm_sites WHERE domain_id=NEW.domain_id)>=(SELECT site_limit FROM farm_domains WHERE id=NEW.domain_id);
END;
CREATE TRIGGER farm_capacity_move BEFORE UPDATE OF domain_id ON farm_sites WHEN OLD.domain_id<>NEW.domain_id BEGIN
 SELECT RAISE(ABORT,'FARM_DOMAIN_INACTIVE') WHERE NOT EXISTS(SELECT 1 FROM farm_domains WHERE id=NEW.domain_id AND active=1 AND zone_status='active');
 SELECT RAISE(ABORT,'FARM_CAPACITY') WHERE (SELECT site_limit FROM farm_domains WHERE id=NEW.domain_id) IS NOT NULL AND (SELECT COUNT(*) FROM farm_sites WHERE domain_id=NEW.domain_id)>=(SELECT site_limit FROM farm_domains WHERE id=NEW.domain_id);
END;

