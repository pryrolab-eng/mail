-- ============================================================
-- FIX sent_emails RLS — Run this in Supabase SQL Editor
-- This is the most likely reason Follow-Up shows nothing
-- ============================================================

-- Ensure table exists with all columns
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
  followup_stopped BOOLEAN DEFAULT false,
  tracking_pixel_id TEXT,
  smtp_account_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add any missing columns
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS to_email TEXT;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS tracking_pixel_id TEXT;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS smtp_account_id UUID;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS bounce_reason TEXT;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS followup_stopped BOOLEAN DEFAULT false;

-- Enable RLS
ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies and start clean
DROP POLICY IF EXISTS "Users manage own sent_emails" ON public.sent_emails;
DROP POLICY IF EXISTS "Users can view own sent_emails" ON public.sent_emails;
DROP POLICY IF EXISTS "Users can insert own sent_emails" ON public.sent_emails;
DROP POLICY IF EXISTS "Users can update own sent_emails" ON public.sent_emails;
DROP POLICY IF EXISTS "Service role full access sent_emails" ON public.sent_emails;
DROP POLICY IF EXISTS "Allow service role" ON public.sent_emails;

-- Policy 1: Users can read their own emails
CREATE POLICY "read own sent_emails"
  ON public.sent_emails FOR SELECT
  USING (auth.uid() = user_id);

-- Policy 2: Users can insert their own emails  
CREATE POLICY "insert own sent_emails"
  ON public.sent_emails FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy 3: Users can update their own emails
CREATE POLICY "update own sent_emails"
  ON public.sent_emails FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy 4: Service role bypass (used by API routes)
-- This is CRITICAL — without this, server-side inserts fail
CREATE POLICY "service role bypass"
  ON public.sent_emails
  USING (true)
  WITH CHECK (true);

-- Enable realtime
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sent_emails;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Verify: show recent sent emails
SELECT id, user_id, to_email, subject, status, sent_at
FROM public.sent_emails
ORDER BY sent_at DESC
LIMIT 10;
