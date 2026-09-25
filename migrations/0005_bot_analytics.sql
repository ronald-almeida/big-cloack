-- Historical records remain unknown: never infer humanity from missing data.
ALTER TABLE clicks ADD COLUMN classification TEXT NOT NULL DEFAULT 'unknown' CHECK(classification IN ('human','confirmed_bot','probable_bot','unknown'));
ALTER TABLE clicks ADD COLUMN is_bot INTEGER CHECK(is_bot IN (0,1));
ALTER TABLE clicks ADD COLUMN bot_confidence INTEGER CHECK(bot_confidence BETWEEN 0 AND 100);
ALTER TABLE clicks ADD COLUMN bot_provider TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE clicks ADD COLUMN bot_reason TEXT NOT NULL DEFAULT '[]';
ALTER TABLE clicks ADD COLUMN user_agent TEXT;
ALTER TABLE clicks ADD COLUMN ip TEXT;
ALTER TABLE clicks ADD COLUMN asn INTEGER;
ALTER TABLE clicks ADD COLUMN request_method TEXT NOT NULL DEFAULT 'GET';
ALTER TABLE clicks ADD COLUMN referer TEXT;
ALTER TABLE clicks ADD COLUMN cf_ray TEXT;
ALTER TABLE clicks ADD COLUMN traffic_signals TEXT NOT NULL DEFAULT '{}';
ALTER TABLE clicks ADD COLUMN classifier_version INTEGER;
CREATE INDEX clicks_classification_date ON clicks(classification,created_at);
CREATE INDEX clicks_provider_date ON clicks(bot_provider,created_at);
CREATE INDEX clicks_origin_rate ON clicks(hostname,ip,created_at);
