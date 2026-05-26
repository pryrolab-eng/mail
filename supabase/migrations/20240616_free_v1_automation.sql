-- Free v1 local automation: assisted pipeline, worker queue, safety settings.

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_pipeline_stage_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_pipeline_stage_check
  CHECK (
    pipeline_stage IN (
      'scraped',
      'verified',
      'enriched',
      'researched',
      'email_drafted',
      'approval_pending',
      'approved',
      'queued',
      'sent',
      'replied',
      'followup_due',
      'completed',
      'failed',
      'call_list'
    )
  );

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS automation_score INTEGER,
  ADD COLUMN IF NOT EXISTS automation_fit_reason TEXT,
  ADD COLUMN IF NOT EXISTS automation_risk TEXT,
  ADD COLUMN IF NOT EXISTS automation_recommended_action TEXT,
  ADD COLUMN IF NOT EXISTS automation_review_required BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS automation_last_scored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS automation_rejected_reason TEXT;

ALTER TABLE public.generated_emails
  ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS quality_score INTEGER,
  ADD COLUMN IF NOT EXISTS ai_score INTEGER,
  ADD COLUMN IF NOT EXISTS ai_score_reason TEXT;

UPDATE public.smtp_accounts
SET daily_limit = LEAST(COALESCE(daily_limit, 50), 50)
WHERE provider = 'gmail' OR email ILIKE '%@gmail.com';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'generated_emails_approval_status_check'
      AND conrelid = 'public.generated_emails'::regclass
  ) THEN
    ALTER TABLE public.generated_emails
      ADD CONSTRAINT generated_emails_approval_status_check
      CHECK (approval_status IN ('draft', 'pending', 'approved', 'rejected', 'sent'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.automation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  automation_mode TEXT NOT NULL DEFAULT 'assisted',
  provider TEXT NOT NULL DEFAULT 'groq',
  daily_send_limit INTEGER NOT NULL DEFAULT 500,
  per_account_daily_limit INTEGER NOT NULL DEFAULT 50,
  send_window_start TIME NOT NULL DEFAULT '09:00',
  send_window_end TIME NOT NULL DEFAULT '17:00',
  timezone TEXT NOT NULL DEFAULT 'Africa/Kigali',
  require_approval_before_send BOOLEAN NOT NULL DEFAULT true,
  allow_low_confidence_autosend BOOLEAN NOT NULL DEFAULT false,
  min_lead_score INTEGER NOT NULL DEFAULT 70,
  worker_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.automation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_jobs_status_check'
      AND conrelid = 'public.automation_jobs'::regclass
  ) THEN
    ALTER TABLE public.automation_jobs
      ADD CONSTRAINT automation_jobs_status_check
      CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.email_suppression_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'automation',
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, email)
);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_due
  ON public.automation_jobs(status, scheduled_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automation_jobs_user_type
  ON public.automation_jobs(user_id, job_type, status);
CREATE INDEX IF NOT EXISTS idx_email_suppression_user_email
  ON public.email_suppression_list(user_id, email);
CREATE INDEX IF NOT EXISTS idx_generated_emails_approval
  ON public.generated_emails(user_id, approval_status, created_at DESC);

ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppression_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own automation settings" ON public.automation_settings;
CREATE POLICY "Users manage own automation settings"
  ON public.automation_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users view own automation jobs" ON public.automation_jobs;
CREATE POLICY "Users view own automation jobs"
  ON public.automation_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own suppression list" ON public.email_suppression_list;
CREATE POLICY "Users manage own suppression list"
  ON public.email_suppression_list
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_automation_settings_updated_at ON public.automation_settings;
CREATE TRIGGER touch_automation_settings_updated_at
  BEFORE UPDATE ON public.automation_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_automation_jobs_updated_at ON public.automation_jobs;
CREATE TRIGGER touch_automation_jobs_updated_at
  BEFORE UPDATE ON public.automation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
