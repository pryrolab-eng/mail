-- ============================================
-- CREATE SMTP ACCOUNTS TABLE
-- Run this in Supabase SQL Editor
-- ============================================

-- Create SMTP accounts table
CREATE TABLE IF NOT EXISTS smtp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  user_name VARCHAR(255) NOT NULL,
  password TEXT NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'gmail',
  daily_limit INTEGER NOT NULL DEFAULT 500,
  sent_today INTEGER NOT NULL DEFAULT 0,
  last_reset TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create email campaigns table
CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  template_subject TEXT NOT NULL,
  template_body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create email queue table
CREATE TABLE IF NOT EXISTS email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE,
  lead_id UUID,
  smtp_account_id UUID REFERENCES smtp_accounts(id) ON DELETE SET NULL,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_name VARCHAR(255),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_smtp_accounts_user_id ON smtp_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_smtp_accounts_status ON smtp_accounts(status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_user_id ON email_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_user_id ON email_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);

-- Enable RLS
ALTER TABLE smtp_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own SMTP accounts" ON smtp_accounts;
DROP POLICY IF EXISTS "Users can insert their own SMTP accounts" ON smtp_accounts;
DROP POLICY IF EXISTS "Users can update their own SMTP accounts" ON smtp_accounts;
DROP POLICY IF EXISTS "Users can delete their own SMTP accounts" ON smtp_accounts;

DROP POLICY IF EXISTS "Users can view their own campaigns" ON email_campaigns;
DROP POLICY IF EXISTS "Users can insert their own campaigns" ON email_campaigns;
DROP POLICY IF EXISTS "Users can update their own campaigns" ON email_campaigns;
DROP POLICY IF EXISTS "Users can delete their own campaigns" ON email_campaigns;

DROP POLICY IF EXISTS "Users can view their own email queue" ON email_queue;
DROP POLICY IF EXISTS "Users can insert their own email queue" ON email_queue;
DROP POLICY IF EXISTS "Users can update their own email queue" ON email_queue;
DROP POLICY IF EXISTS "Users can delete their own email queue" ON email_queue;

-- Create RLS policies
CREATE POLICY "Users can view their own SMTP accounts"
  ON smtp_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own SMTP accounts"
  ON smtp_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own SMTP accounts"
  ON smtp_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own SMTP accounts"
  ON smtp_accounts FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own campaigns"
  ON email_campaigns FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own campaigns"
  ON email_campaigns FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own campaigns"
  ON email_campaigns FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own campaigns"
  ON email_campaigns FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own email queue"
  ON email_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own email queue"
  ON email_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own email queue"
  ON email_queue FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own email queue"
  ON email_queue FOR DELETE
  USING (auth.uid() = user_id);

-- Verify tables were created
SELECT 'smtp_accounts' as table_name, COUNT(*) as row_count FROM smtp_accounts
UNION ALL
SELECT 'email_campaigns', COUNT(*) FROM email_campaigns
UNION ALL
SELECT 'email_queue', COUNT(*) FROM email_queue;
