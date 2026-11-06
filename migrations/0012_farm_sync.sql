-- Shared revision for Farm reads. Does not touch redirector tables.
CREATE TABLE IF NOT EXISTS farm_sync (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO farm_sync(id) VALUES(1);
CREATE TRIGGER IF NOT EXISTS farm_domains_sync_insert AFTER INSERT ON farm_domains
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_domains_sync_update AFTER UPDATE ON farm_domains
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_domains_sync_delete AFTER DELETE ON farm_domains
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_sites_sync_insert AFTER INSERT ON farm_sites
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_sites_sync_update AFTER UPDATE ON farm_sites
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_sites_sync_delete AFTER DELETE ON farm_sites
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_deployments_sync_insert AFTER INSERT ON farm_deployments
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_deployments_sync_update AFTER UPDATE ON farm_deployments
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_deployments_sync_delete AFTER DELETE ON farm_deployments
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_ownership_sync_insert AFTER INSERT ON farm_ownership
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_ownership_sync_update AFTER UPDATE ON farm_ownership
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_ownership_sync_delete AFTER DELETE ON farm_ownership
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_operations_sync_insert AFTER INSERT ON farm_operations
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_operations_sync_update AFTER UPDATE ON farm_operations
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS farm_operations_sync_delete AFTER DELETE ON farm_operations
BEGIN UPDATE farm_sync SET revision=revision+1 WHERE id=1; END;
