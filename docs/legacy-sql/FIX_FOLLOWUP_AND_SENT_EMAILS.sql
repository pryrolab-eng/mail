-- ============================================================
-- FIX FOLLOW-UP SYSTEM — Run this in Supabase SQL Editor
-- ============================================================

-- ── 1. Ensure sent_emails table exists with ALL required columns ──────────────
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

-- ── 2. Add any missing columns (safe — IF NOT EXISTS) ─────────────────────────
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS to_email TEXT;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS tracking_pixel_id TEXT;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS smtp_account_id UUID;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS bounce_reason TEXT;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS followup_count INTEGER DEFAULT 0;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS followup_stopped BOOLEAN DEFAULT false;

-- ── 3. Enable RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;

-- ── 4. Drop and recreate RLS policies (clean slate) ──────────────────────────
DROP POLICY IF EXISTS "Users manage own sent_emails" ON public.sent_emails;
DROP POLICY IF EXISTS "Users can view own sent_emails" ON public.sent_emails;
DROP POLICY IF EXISTS "Users can insert own sent_emails" ON public.sent_emails;
DROP POLICY IF EXISTS "Users can update own sent_emails" ON public.sent_emails;
DROP POLICY IF EXISTS "Service role full access sent_emails" ON public.sent_emails;

-- Allow authenticated users to read their own sent emails
CREATE POLICY "Users can view own sent_emails"
  ON public.sent_emails FOR SELECT
  USING (auth.uid() = user_id);

-- Allow authenticated users to insert their own sent emails
CREATE POLICY "Users can insert own sent_emails"
  ON public.sent_emails FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to update their own sent emails
CREATE POLICY "Users can update own sent_emails"
  ON public.sent_emails FOR UPDATE
  USING (auth.uid() = user_id);

-- Allow service role full access (used by server-side API routes)
CREATE POLICY "Service role full access sent_emails"
  ON public.sent_emails
  USING (true)
  WITH CHECK (true);

-- ── 5. Enable realtime for sent_emails ───────────────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sent_emails;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ── 6. Verify: show all sent emails ──────────────────────────────────────────
SELECT 
  id,
  user_id,
  to_email,
  subject,
  status,
  sent_at,
  bounce_reason
FROM public.sent_emails
ORDER BY sent_at DESC
LIMIT 20;
