-- ============================================================
-- FIX SENT EMAILS TABLE — Run this in Supabase SQL Editor
-- This ensures all required columns exist so emails get recorded
-- ============================================================

-- Create sent_emails table if it doesn't exist at all
CREATE TABLE IF NOT EXISTS public.sent_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  campaign_id UUID,
  to_email TEXT,
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  status TEXT DEFAULT 'sent',
  bounce_reason TEXT,
  followup_count INTEGER DEFAULT 0,
  next_followup_at TIMESTAMPTZ,
  followup_stopped BOOLEAN DEFAULT false,
  smtp_message_id TEXT,
  in_reply_to TEXT,
  thread_id TEXT,
  tracking_pixel_id TEXT,
  smtp_account_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add any missing columns (safe to run multiple times)
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS to_email TEXT;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS tracking_pixel_id TEXT;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS smtp_account_id UUID;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS bounce_reason TEXT;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS followup_count INTEGER DEFAULT 0;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS next_followup_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS followup_stopped BOOLEAN DEFAULT false;

-- Enable RLS
ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policy to ensure it's correct
DROP POLICY IF EXISTS "Users manage own sent_emails" ON public.sent_emails;
CREATE POLICY "Users manage own sent_emails" ON public.sent_emails
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_sent_emails_user_id ON public.sent_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_lead_id ON public.sent_emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_status ON public.sent_emails(status);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON public.sent_emails(sent_at DESC);

-- Enable realtime
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sent_emails;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Verify: show current columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sent_emails'
ORDER BY ordinal_position;
