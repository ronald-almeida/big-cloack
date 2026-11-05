-- Additive metadata only. Existing Farm and redirector rows are preserved.
CREATE TABLE IF NOT EXISTS farm_ownership (
  kind TEXT NOT NULL CHECK(kind IN ('site','domain')),
  entity_id TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'ADMIN',
  bm TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(kind,entity_id)
);
CREATE TABLE IF NOT EXISTS farm_operations (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  command TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','done','failed')),
  response TEXT,
  response_status INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS farm_bridge_lock (
  id INTEGER PRIMARY KEY CHECK(id=1),
  lease TEXT,
  expires INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO farm_bridge_lock(id) VALUES(1);
