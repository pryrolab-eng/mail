-- ============================================================
-- PRYRO PLATFORM — COMPLETE UPGRADE MIGRATION
-- Run this in Supabase SQL Editor to upgrade the platform
-- ============================================================

-- ── 1. Update lead statuses to full set ──────────────────────────────────────
-- Add new status values: contacted, opened, clicked, bounced, failed
-- (existing: New, Email Sent, Replied, Interested, Closed, Dead are kept)

-- ── 2. Add missing columns to leads ──────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;

-- ── 3. Add missing columns to sent_emails ────────────────────────────────────
ALTER TABLE public.sent_emails
  ADD COLUMN IF NOT EXISTS to_email TEXT,
  ADD COLUMN IF NOT EXISTS followup_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_followup_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS followup_stopped BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS smtp_message_id TEXT,
  ADD COLUMN IF NOT EXISTS in_reply_to TEXT,
  ADD COLUMN IF NOT EXISTS thread_id TEXT,
  ADD COLUMN IF NOT EXISTS bounce_reason TEXT,
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_pixel_id TEXT,
  ADD COLUMN IF NOT EXISTS smtp_account_id UUID REFERENCES smtp_accounts(id) ON DELETE SET NULL;

-- ── 4. Create sent_emails if it doesn't exist ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sent_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  campaign_id UUID,
  sequence_id UUID,
  to_email TEXT,
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
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

-- ── 5. Create email_replies if it doesn't exist ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sent_email_id UUID REFERENCES public.sent_emails(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  from_email TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  is_positive BOOLEAN,
  sentiment TEXT,
  ai_response_generated BOOLEAN DEFAULT false,
  ai_response_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Create ai_replies if it doesn't exist ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reply_id UUID REFERENCES public.email_replies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  subject TEXT,
  body TEXT NOT NULL,
  tone TEXT,
  model_used TEXT,
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. Create email_inbox_config if it doesn't exist ─────────────────────────
CREATE TABLE IF NOT EXISTS public.email_inbox_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email_address TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'imap',
  access_token TEXT,
  refresh_token TEXT,
  imap_host TEXT,
  imap_port INTEGER DEFAULT 993,
  imap_username TEXT,
  imap_password TEXT,
  last_checked_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  auto_reply_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. Create email_sequences if it doesn't exist ────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE CASCADE NOT NULL,
  sequence_number INTEGER NOT NULL DEFAULT 1,
  delay_days INTEGER NOT NULL DEFAULT 3,
  subject_template TEXT,
  body_template TEXT,
  tone TEXT DEFAULT 'professional',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 9. Create followup_queue if it doesn't exist ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.followup_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sent_email_id UUID REFERENCES public.sent_emails(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  campaign_id UUID,
  sequence_id UUID,
  followup_number INTEGER NOT NULL DEFAULT 1,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  subject TEXT,
  body TEXT,
  error_message TEXT,
  skip_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 10. Create followup_settings if it doesn't exist ─────────────────────────
CREATE TABLE IF NOT EXISTS public.followup_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  auto_followup_enabled BOOLEAN DEFAULT false,
  default_delay_days INTEGER DEFAULT 3,
  max_followups INTEGER DEFAULT 3,
  stop_on_reply BOOLEAN DEFAULT true,
  followup_tone TEXT DEFAULT 'professional',
  your_company TEXT,
  your_service TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 11. Create notifications table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL, -- 'reply', 'bounce', 'smtp_error', 'campaign_complete', 'scrape_done', 'failed_email'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 12. Create csv_imports table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.csv_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  filename TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  imported_rows INTEGER DEFAULT 0,
  failed_rows INTEGER DEFAULT 0,
  duplicate_rows INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing', -- processing, completed, failed
  error_log JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ── 13. Create lead_categories if it doesn't exist ───────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#2563EB',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- ── 14. Create analytics_events table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL, -- 'email_opened', 'email_clicked', 'email_bounced', 'email_replied'
  sent_email_id UUID REFERENCES public.sent_emails(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  campaign_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 15. Create email_templates if it doesn't exist ───────────────────────────
CREATE TABLE IF NOT EXISTS public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  tone TEXT DEFAULT 'professional',
  niche TEXT,
  variables JSONB DEFAULT '[]',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 16. Add missing columns to smtp_accounts ─────────────────────────────────
ALTER TABLE public.smtp_accounts
  ADD COLUMN IF NOT EXISTS warmup_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS warmup_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS total_sent INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bounced INTEGER DEFAULT 0;

-- ── 17. Add missing columns to email_campaigns ───────────────────────────────
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS bounced_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS niche TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- ── 18. Create the followup_due view ─────────────────────────────────────────
CREATE OR REPLACE VIEW public.followup_due AS
SELECT
  se.id AS sent_email_id,
  se.user_id,
  se.lead_id,
  se.campaign_id,
  se.subject AS original_subject,
  se.body AS original_body,
  se.sent_at,
  se.followup_count,
  se.next_followup_at,
  l.company_name,
  l.email AS lead_email,
  l.niche,
  l.location,
  l.company_context,
  l.status AS lead_status,
  COALESCE(fs.max_followups, 3) AS max_followups,
  COALESCE(fs.default_delay_days, 3) AS default_delay_days,
  COALESCE(fs.stop_on_reply, true) AS stop_on_reply,
  fs.followup_tone,
  fs.your_company,
  fs.your_service
FROM public.sent_emails se
JOIN public.leads l ON l.id = se.lead_id
LEFT JOIN public.followup_settings fs ON fs.user_id = se.user_id
WHERE
  se.followup_stopped = false
  AND se.next_followup_at IS NOT NULL
  AND se.next_followup_at <= NOW()
  AND se.followup_count < COALESCE(fs.max_followups, 3)
  AND l.email IS NOT NULL;

-- ── 19. Create analytics summary view ────────────────────────────────────────
CREATE OR REPLACE VIEW public.analytics_summary AS
SELECT
  se.user_id,
  COUNT(se.id) AS total_sent,
  COUNT(se.opened_at) AS total_opened,
  COUNT(se.clicked_at) AS total_clicked,
  COUNT(se.replied_at) AS total_replied,
  COUNT(CASE WHEN se.status = 'bounced' THEN 1 END) AS total_bounced,
  COUNT(CASE WHEN se.status = 'failed' THEN 1 END) AS total_failed,
  ROUND(
    CASE WHEN COUNT(se.id) > 0
    THEN COUNT(se.opened_at)::NUMERIC / COUNT(se.id) * 100
    ELSE 0 END, 2
  ) AS open_rate,
  ROUND(
    CASE WHEN COUNT(se.id) > 0
    THEN COUNT(se.replied_at)::NUMERIC / COUNT(se.id) * 100
    ELSE 0 END, 2
  ) AS reply_rate,
  ROUND(
    CASE WHEN COUNT(se.id) > 0
    THEN COUNT(CASE WHEN se.status = 'bounced' THEN 1 END)::NUMERIC / COUNT(se.id) * 100
    ELSE 0 END, 2
  ) AS bounce_rate
FROM public.sent_emails se
GROUP BY se.user_id;

-- ── 20. Indexes for performance ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sent_emails_user_id ON public.sent_emails(user_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_lead_id ON public.sent_emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_status ON public.sent_emails(status);
CREATE INDEX IF NOT EXISTS idx_sent_emails_next_followup ON public.sent_emails(next_followup_at) WHERE followup_stopped = false;
CREATE INDEX IF NOT EXISTS idx_email_replies_user_id ON public.email_replies(user_id);
CREATE INDEX IF NOT EXISTS idx_email_replies_lead_id ON public.email_replies(lead_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON public.analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON public.analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_status ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_niche ON public.leads(niche);

-- ── 21. RLS Policies ──────────────────────────────────────────────────────────
ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_inbox_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followup_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.csv_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- sent_emails policies
DROP POLICY IF EXISTS "Users manage own sent_emails" ON public.sent_emails;
CREATE POLICY "Users manage own sent_emails" ON public.sent_emails
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- email_replies policies
DROP POLICY IF EXISTS "Users manage own email_replies" ON public.email_replies;
CREATE POLICY "Users manage own email_replies" ON public.email_replies
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ai_replies policies
DROP POLICY IF EXISTS "Users manage own ai_replies" ON public.ai_replies;
CREATE POLICY "Users manage own ai_replies" ON public.ai_replies
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- email_inbox_config policies
DROP POLICY IF EXISTS "Users manage own inbox_config" ON public.email_inbox_config;
CREATE POLICY "Users manage own inbox_config" ON public.email_inbox_config
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- followup_queue policies
DROP POLICY IF EXISTS "Users manage own followup_queue" ON public.followup_queue;
CREATE POLICY "Users manage own followup_queue" ON public.followup_queue
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- followup_settings policies
DROP POLICY IF EXISTS "Users manage own followup_settings" ON public.followup_settings;
CREATE POLICY "Users manage own followup_settings" ON public.followup_settings
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- notifications policies
DROP POLICY IF EXISTS "Users manage own notifications" ON public.notifications;
CREATE POLICY "Users manage own notifications" ON public.notifications
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- csv_imports policies
DROP POLICY IF EXISTS "Users manage own csv_imports" ON public.csv_imports;
CREATE POLICY "Users manage own csv_imports" ON public.csv_imports
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- lead_categories policies
DROP POLICY IF EXISTS "Users manage own lead_categories" ON public.lead_categories;
CREATE POLICY "Users manage own lead_categories" ON public.lead_categories
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- analytics_events policies
DROP POLICY IF EXISTS "Users manage own analytics_events" ON public.analytics_events;
CREATE POLICY "Users manage own analytics_events" ON public.analytics_events
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- email_templates policies
DROP POLICY IF EXISTS "Users manage own email_templates" ON public.email_templates;
CREATE POLICY "Users manage own email_templates" ON public.email_templates
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- email_sequences policies
DROP POLICY IF EXISTS "Users manage own email_sequences" ON public.email_sequences;
CREATE POLICY "Users manage own email_sequences" ON public.email_sequences
  USING (
    EXISTS (
      SELECT 1 FROM email_campaigns ec
      WHERE ec.id = email_sequences.campaign_id AND ec.user_id = auth.uid()
    )
  );

-- ── 22. Enable Realtime ───────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sent_emails;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.email_replies;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.followup_queue;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ── 23. Function: create notification ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT,
  p_data JSONB DEFAULT '{}'
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, message, data)
  VALUES (p_user_id, p_type, p_title, p_message, p_data)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 24. Function: update lead status with history ────────────────────────────
CREATE OR REPLACE FUNCTION public.update_lead_status(
  p_lead_id UUID,
  p_new_status TEXT,
  p_user_id UUID
) RETURNS VOID AS $$
DECLARE
  v_old_status TEXT;
BEGIN
  SELECT status INTO v_old_status FROM public.leads WHERE id = p_lead_id AND user_id = p_user_id;
  
  IF v_old_status IS NOT NULL AND v_old_status != p_new_status THEN
    UPDATE public.leads
    SET status = p_new_status, updated_at = NOW()
    WHERE id = p_lead_id AND user_id = p_user_id;
    
    INSERT INTO public.lead_status_history (lead_id, old_status, new_status)
    VALUES (p_lead_id, v_old_status, p_new_status);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 25. Trigger: auto-update lead status on email events ─────────────────────
CREATE OR REPLACE FUNCTION public.handle_email_status_change()
RETURNS TRIGGER AS $$
BEGIN
  -- When email is marked as bounced, update lead status
  IF NEW.status = 'bounced' AND OLD.status != 'bounced' THEN
    UPDATE public.leads SET status = 'bounced', updated_at = NOW()
    WHERE id = NEW.lead_id AND user_id = NEW.user_id;
    
    INSERT INTO public.lead_status_history (lead_id, old_status, new_status)
    SELECT NEW.lead_id, l.status, 'bounced'
    FROM public.leads l WHERE l.id = NEW.lead_id;
    
    -- Create notification
    PERFORM public.create_notification(
      NEW.user_id,
      'bounce',
      'Email Bounced',
      'Email to ' || NEW.to_email || ' bounced: ' || COALESCE(NEW.bounce_reason, 'unknown reason'),
      jsonb_build_object('sent_email_id', NEW.id, 'lead_id', NEW.lead_id, 'email', NEW.to_email)
    );
  END IF;
  
  -- When email is opened, update lead status to 'opened'
  IF NEW.opened_at IS NOT NULL AND OLD.opened_at IS NULL THEN
    UPDATE public.leads SET status = 'opened', updated_at = NOW()
    WHERE id = NEW.lead_id AND user_id = NEW.user_id AND status = 'Email Sent';
  END IF;
  
  -- When email is clicked, update lead status to 'clicked'
  IF NEW.clicked_at IS NOT NULL AND OLD.clicked_at IS NULL THEN
    UPDATE public.leads SET status = 'clicked', updated_at = NOW()
    WHERE id = NEW.lead_id AND user_id = NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS email_status_change_trigger ON public.sent_emails;
CREATE TRIGGER email_status_change_trigger
  AFTER UPDATE ON public.sent_emails
  FOR EACH ROW EXECUTE FUNCTION public.handle_email_status_change();

-- ── 26. Trigger: auto-create notification on new reply ───────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_reply()
RETURNS TRIGGER AS $$
BEGIN
  -- Update lead status to 'replied'
  UPDATE public.leads SET status = 'replied', updated_at = NOW()
  WHERE id = NEW.lead_id AND user_id = NEW.user_id;
  
  -- Update sent_email replied_at
  UPDATE public.sent_emails SET replied_at = NOW(), status = 'replied'
  WHERE id = NEW.sent_email_id;
  
  -- Create notification
  PERFORM public.create_notification(
    NEW.user_id,
    'reply',
    'New Reply Received',
    'Reply from ' || NEW.from_email || ': ' || LEFT(NEW.body, 100),
    jsonb_build_object(
      'reply_id', NEW.id,
      'lead_id', NEW.lead_id,
      'from_email', NEW.from_email,
      'sentiment', NEW.sentiment
    )
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS new_reply_trigger ON public.email_replies;
CREATE TRIGGER new_reply_trigger
  AFTER INSERT ON public.email_replies
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_reply();
