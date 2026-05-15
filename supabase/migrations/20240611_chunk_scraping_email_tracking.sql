-- ============================================================
-- CHUNK SCRAPING + EMAIL TRACKING UPGRADE
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── 1. scrape_jobs — tracks chunk-based scrape progress ──────────────────────
CREATE TABLE IF NOT EXISTS public.scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  niche TEXT NOT NULL,
  location TEXT NOT NULL,
  max_results INTEGER NOT NULL DEFAULT 100,
  chunk_size INTEGER NOT NULL DEFAULT 25,
  status TEXT NOT NULL DEFAULT 'running', -- running, completed, failed, cancelled
  total_scraped INTEGER DEFAULT 0,
  total_saved INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  total_chunks INTEGER DEFAULT 0,
  current_chunk INTEGER DEFAULT 0,
  error_log JSONB DEFAULT '[]',
  source TEXT DEFAULT 'scraper', -- scraper | csv_import
  original_filename TEXT,        -- for CSV imports
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own scrape_jobs" ON public.scrape_jobs;
CREATE POLICY "Users manage own scrape_jobs" ON public.scrape_jobs
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_user_id ON public.scrape_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON public.scrape_jobs(status);

-- ── 2. Add tracking columns to sent_emails (safe if already exist) ───────────
ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS tracking_pixel_id TEXT,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- ── 3. lead_status_history — referenced by existing triggers ─────────────────
CREATE TABLE IF NOT EXISTS public.lead_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_status_history_lead_id ON public.lead_status_history(lead_id);

-- ── 4. Enable realtime on scrape_jobs ────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scrape_jobs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
