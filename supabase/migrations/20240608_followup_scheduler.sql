-- ============================================================
-- Follow-Up Scheduler Migration
-- Adds the infrastructure needed for automated follow-up sending
-- ============================================================

-- Add follow-up tracking columns to sent_emails
ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS followup_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_followup_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS followup_stopped BOOLEAN NOT NULL DEFAULT false;

-- Index so the scheduler can quickly find emails that are due
CREATE INDEX IF NOT EXISTS idx_sent_emails_next_followup
  ON public.sent_emails(next_followup_at)
  WHERE next_followup_at IS NOT NULL
    AND followup_stopped = false
    AND status NOT IN ('replied', 'bounced');

-- -------------------------------------------------------
-- followup_queue: one row per pending follow-up send
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.followup_queue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_email_id    UUID NOT NULL REFERENCES public.sent_emails(id) ON DELETE CASCADE,
  lead_id          UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  campaign_id      UUID REFERENCES public.email_campaigns(id) ON DELETE SET NULL,
  sequence_id      UUID REFERENCES public.email_sequences(id) ON DELETE SET NULL,
  followup_number  INTEGER NOT NULL DEFAULT 1,   -- 1st, 2nd, 3rd follow-up
  scheduled_at     TIMESTAMPTZ NOT NULL,
  sent_at          TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'pending', -- pending, sent, skipped, failed
  skip_reason      TEXT,                            -- 'replied', 'max_reached', 'lead_dead'
  subject          TEXT,
  body             TEXT,
  error_message    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the scheduler query
CREATE INDEX IF NOT EXISTS idx_followup_queue_scheduled
  ON public.followup_queue(scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_followup_queue_user_id
  ON public.followup_queue(user_id);

CREATE INDEX IF NOT EXISTS idx_followup_queue_sent_email_id
  ON public.followup_queue(sent_email_id);

-- RLS
ALTER TABLE public.followup_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own followup queue"
  ON public.followup_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own followup queue"
  ON public.followup_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own followup queue"
  ON public.followup_queue FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own followup queue"
  ON public.followup_queue FOR DELETE
  USING (auth.uid() = user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_followup_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_followup_queue_updated_at ON public.followup_queue;
CREATE TRIGGER trigger_followup_queue_updated_at
  BEFORE UPDATE ON public.followup_queue
  FOR EACH ROW EXECUTE FUNCTION update_followup_queue_updated_at();

-- Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'followup_queue'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.followup_queue;
  END IF;
END $$;

-- -------------------------------------------------------
-- followup_settings: ensure the table has all needed cols
-- (table was created in 20240605 migration)
-- -------------------------------------------------------
ALTER TABLE public.followup_settings
  ADD COLUMN IF NOT EXISTS followup_tone TEXT DEFAULT 'professional',
  ADD COLUMN IF NOT EXISTS followup_subject_prefix TEXT DEFAULT 'Re: ',
  ADD COLUMN IF NOT EXISTS your_company TEXT,
  ADD COLUMN IF NOT EXISTS your_service TEXT;

-- -------------------------------------------------------
-- Helper view: emails that are due for a follow-up right now
-- -------------------------------------------------------
CREATE OR REPLACE VIEW public.followup_due AS
SELECT
  se.id              AS sent_email_id,
  se.user_id,
  se.lead_id,
  se.campaign_id,
  se.subject         AS original_subject,
  se.body            AS original_body,
  se.sent_at,
  se.followup_count,
  se.next_followup_at,
  l.company_name,
  l.email            AS lead_email,
  l.niche,
  l.location,
  l.company_context,
  l.status           AS lead_status,
  fs.max_followups,
  fs.default_delay_days,
  fs.stop_on_reply,
  fs.followup_tone,
  fs.your_company,
  fs.your_service
FROM public.sent_emails se
JOIN public.leads l
  ON l.id = se.lead_id
JOIN public.followup_settings fs
  ON fs.user_id = se.user_id
WHERE
  se.followup_stopped = false
  AND se.status NOT IN ('replied', 'bounced')
  AND l.status NOT IN ('Replied', 'Interested', 'Closed', 'Dead')
  AND se.next_followup_at IS NOT NULL
  AND se.next_followup_at <= NOW()
  AND se.followup_count < fs.max_followups
  AND fs.auto_followup_enabled = true;
