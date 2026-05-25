-- SMTP/MX verification metadata on scraped leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_verification_reason TEXT;
