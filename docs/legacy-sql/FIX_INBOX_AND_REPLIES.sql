-- ============================================================================
-- FIX INBOX AND REPLIES
-- Run this in Supabase SQL Editor to enable reply detection
-- ============================================================================

-- 1. Add smtp_message_id to sent_emails (for Message-ID header matching)
ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS smtp_message_id TEXT,
  ADD COLUMN IF NOT EXISTS to_email TEXT;

-- Index for fast reply matching
CREATE INDEX IF NOT EXISTS idx_sent_emails_smtp_message_id
  ON public.sent_emails(smtp_message_id)
  WHERE smtp_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sent_emails_to_email
  ON public.sent_emails(to_email);

-- 2. Create email_inbox_config table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.email_inbox_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_address TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'imap',
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_username TEXT NOT NULL,
  imap_password TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_reply_enabled BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, email_address)
);

CREATE INDEX IF NOT EXISTS idx_email_inbox_config_user_id
  ON public.email_inbox_config(user_id);

ALTER TABLE public.email_inbox_config ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists, then recreate
DROP POLICY IF EXISTS "Users can manage their own inbox configs" ON public.email_inbox_config;

CREATE POLICY "Users can manage their own inbox configs"
  ON public.email_inbox_config FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Add replied_at to sent_emails if missing
ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

-- 4. Verify email_replies table has all needed columns
ALTER TABLE public.email_replies
  ADD COLUMN IF NOT EXISTS ai_response_sent BOOLEAN DEFAULT false;

-- Done!
SELECT 'FIX_INBOX_AND_REPLIES applied successfully' AS status;
