CREATE TABLE links (
 id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('real','waiting')) DEFAULT 'waiting',
 device TEXT NOT NULL CHECK(device IN ('all','mobile','desktop')) DEFAULT 'all',
 real_urls TEXT NOT NULL DEFAULT '[]', waiting_url TEXT NOT NULL DEFAULT '',
 version TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE domains (id TEXT PRIMARY KEY, hostname TEXT NOT NULL UNIQUE, verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE clicks (id INTEGER PRIMARY KEY AUTOINCREMENT, link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE, hostname TEXT NOT NULL, device TEXT NOT NULL, destination TEXT NOT NULL, country TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX clicks_link_date ON clicks(link_id,created_at);
CREATE INDEX clicks_date ON clicks(created_at);
