-- ============================================================================
-- EMAIL TRACKING & PROFILE AUTO-FILL DATABASE SETUP
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ── Step 1: Add profile fields to users table (if not exists) ──────────────

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS sender_company TEXT,
ADD COLUMN IF NOT EXISTS sender_service TEXT;

-- Optional: Set default values for your account
-- UPDATE users 
-- SET sender_company = 'Your Company Name',
--     sender_service = 'Your Service/Product Description'
-- WHERE email = 'your-email@example.com';


-- ── Step 2: Create email_history table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,
  
  -- Email content
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  
  -- Status tracking
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'bounced', 'opened', 'clicked', 'replied')),
  smtp_account_id UUID REFERENCES smtp_accounts(id) ON DELETE SET NULL,
  
  -- Timestamps
  sent_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  bounced_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  replied_at TIMESTAMP WITH TIME ZONE,
  
  -- Error tracking
  error_message TEXT,
  bounce_reason TEXT,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE email_history IS 'Tracks all emails sent to leads with delivery status';
COMMENT ON COLUMN email_history.status IS 'Current status: sent, failed, bounced, opened, clicked, replied';


-- ── Step 3: Create indexes for performance ─────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_email_history_user 
  ON email_history(user_id);

CREATE INDEX IF NOT EXISTS idx_email_history_lead 
  ON email_history(lead_id);

CREATE INDEX IF NOT EXISTS idx_email_history_status 
  ON email_history(status);

CREATE INDEX IF NOT EXISTS idx_email_history_sent_at 
  ON email_history(sent_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_email_history_campaign 
  ON email_history(campaign_id) 
  WHERE campaign_id IS NOT NULL;


-- ── Step 4: Enable Row Level Security ──────────────────────────────────────

ALTER TABLE email_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own email history
DROP POLICY IF EXISTS "Users can view their own email history" ON email_history;
CREATE POLICY "Users can view their own email history"
  ON email_history FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own email history
DROP POLICY IF EXISTS "Users can insert their own email history" ON email_history;
CREATE POLICY "Users can insert their own email history"
  ON email_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own email history (for status changes)
DROP POLICY IF EXISTS "Users can update their own email history" ON email_history;
CREATE POLICY "Users can update their own email history"
  ON email_history FOR UPDATE
  USING (auth.uid() = user_id);


-- ── Step 5: Create function to auto-update lead status ─────────────────────

CREATE OR REPLACE FUNCTION update_lead_status_on_email()
RETURNS TRIGGER AS $$
BEGIN
  -- When email is sent successfully, update lead to "Email Sent"
  IF NEW.status = 'sent' AND NEW.sent_at IS NOT NULL THEN
    UPDATE leads 
    SET status = 'Email Sent',
        updated_at = NOW()
    WHERE id = NEW.lead_id;
  END IF;
  
  -- When email fails, update lead to "Dead"
  IF NEW.status = 'failed' AND NEW.failed_at IS NOT NULL THEN
    UPDATE leads 
    SET status = 'Dead',
        updated_at = NOW()
    WHERE id = NEW.lead_id;
  END IF;
  
  -- When lead replies, update to "Replied"
  IF NEW.status = 'replied' AND NEW.replied_at IS NOT NULL THEN
    UPDATE leads 
    SET status = 'Replied',
        updated_at = NOW()
    WHERE id = NEW.lead_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_lead_status ON email_history;
CREATE TRIGGER trigger_update_lead_status
  AFTER INSERT OR UPDATE ON email_history
  FOR EACH ROW
  EXECUTE FUNCTION update_lead_status_on_email();


-- ── Step 6: Create view for email analytics ────────────────────────────────

CREATE OR REPLACE VIEW email_analytics AS
SELECT 
  user_id,
  COUNT(*) as total_emails,
  COUNT(*) FILTER (WHERE status = 'sent') as sent_count,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
  COUNT(*) FILTER (WHERE status = 'bounced') as bounced_count,
  COUNT(*) FILTER (WHERE status = 'opened') as opened_count,
  COUNT(*) FILTER (WHERE status = 'clicked') as clicked_count,
  COUNT(*) FILTER (WHERE status = 'replied') as replied_count,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'opened')::NUMERIC / 
    NULLIF(COUNT(*) FILTER (WHERE status = 'sent'), 0) * 100, 
    2
  ) as open_rate,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'replied')::NUMERIC / 
    NULLIF(COUNT(*) FILTER (WHERE status = 'sent'), 0) * 100, 
    2
  ) as reply_rate
FROM email_history
GROUP BY user_id;

COMMENT ON VIEW email_analytics IS 'Aggregated email performance metrics per user';


-- ── Step 7: Verify setup ───────────────────────────────────────────────────

-- Check if columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
  AND column_name IN ('sender_company', 'sender_service');

-- Check if email_history table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'email_history';

-- Check RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'email_history';

-- ============================================================================
-- SETUP COMPLETE!
-- ============================================================================

-- Next steps:
-- 1. Update your user record with company/service info (uncomment Step 1)
-- 2. Implement code changes in actions.ts and CRMModule.tsx
-- 3. Test email sending and verify status updates
