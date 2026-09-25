ALTER TABLE links ADD COLUMN domain_id TEXT;
CREATE TABLE link_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 link_id TEXT NOT NULL, domain_id TEXT, hostname TEXT,
 name TEXT NOT NULL, slug TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('created','deleted')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX link_events_domain_date ON link_events(domain_id,created_at);
CREATE TABLE clicks_preserved (
 id INTEGER PRIMARY KEY AUTOINCREMENT, link_id TEXT NOT NULL,
 hostname TEXT NOT NULL, device TEXT NOT NULL, destination TEXT NOT NULL,
 country TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 link_name TEXT NOT NULL DEFAULT '', slug TEXT NOT NULL DEFAULT ''
);
INSERT INTO clicks_preserved SELECT c.*,COALESCE(l.name,''),COALESCE(l.slug,'') FROM clicks c LEFT JOIN links l ON l.id=c.link_id;
DROP TABLE clicks;
ALTER TABLE clicks_preserved RENAME TO clicks;
CREATE INDEX clicks_link_date ON clicks(link_id,created_at);
CREATE INDEX clicks_date ON clicks(created_at);
CREATE INDEX clicks_link_id_cursor ON clicks(link_id,id);
CREATE INDEX clicks_domain_date ON clicks(hostname,created_at);

CREATE TRIGGER link_created_history AFTER INSERT ON links BEGIN
 INSERT INTO link_events(link_id,domain_id,hostname,name,slug,event,created_at)
 VALUES(NEW.id,NEW.domain_id,(SELECT hostname FROM domains WHERE id=NEW.domain_id),NEW.name,NEW.slug,'created',NEW.created_at);
END;
CREATE TRIGGER link_deleted_history BEFORE DELETE ON links BEGIN
 UPDATE clicks SET link_name=OLD.name,slug=OLD.slug WHERE link_id=OLD.id AND link_name='';
 INSERT INTO link_events(link_id,domain_id,hostname,name,slug,event)
 VALUES(OLD.id,OLD.domain_id,(SELECT hostname FROM domains WHERE id=OLD.domain_id),OLD.name,OLD.slug,'deleted');
END;
