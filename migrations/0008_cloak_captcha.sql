ALTER TABLE links ADD COLUMN captcha_enabled INTEGER NOT NULL DEFAULT 0;

-- Separate events preserve existing click counts and bot analytics.
CREATE TABLE captcha_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  slug TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('captcha_shown','captcha_passed','captcha_failed')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX captcha_events_time ON captcha_events(created_at);
CREATE INDEX captcha_events_link ON captcha_events(link_id, id);
