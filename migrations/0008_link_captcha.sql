ALTER TABLE links ADD COLUMN captcha_enabled INTEGER NOT NULL DEFAULT 0 CHECK (captcha_enabled IN (0,1));
