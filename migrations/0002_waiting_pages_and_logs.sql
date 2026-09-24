ALTER TABLE links ADD COLUMN waiting_page TEXT NOT NULL DEFAULT '{}';
CREATE INDEX clicks_link_id_cursor ON clicks(link_id, id DESC);
