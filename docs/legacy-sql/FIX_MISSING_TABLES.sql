-- ============================================================
-- FIX: Create missing tables causing 400/500 errors
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. followup_settings (fixes 400 on /rest/v1/followup_settings)
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

ALTER TABLE public.followup_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own followup_settings" ON public.followup_settings;
CREATE POLICY "Users manage own followup_settings" ON public.followup_settings
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. notifications (fixes 500 on /api/notifications)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notifications" ON public.notifications;
CREATE POLICY "Users manage own notifications" ON public.notifications
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id, is_read) WHERE is_read = false;

-- Done. Both tables are now created with proper RLS policies.
