-- ============================================================================
-- COMPLETE DATABASE SETUP FOR EMAIL CRM
-- Run this entire script in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. SMTP ACCOUNTS TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.smtp_accounts CASCADE;

CREATE TABLE public.smtp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  user_name VARCHAR(255) NOT NULL,
  password TEXT NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'Gmail',
  daily_limit INTEGER NOT NULL DEFAULT 500,
  sent_today INTEGER NOT NULL DEFAULT 0,
  last_reset TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, email)
);

CREATE INDEX idx_smtp_accounts_user_id ON public.smtp_accounts(user_id);
CREATE INDEX idx_smtp_accounts_status ON public.smtp_accounts(status);

ALTER TABLE public.smtp_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own SMTP accounts"
  ON public.smtp_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 2. AI SETTINGS TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.ai_settings CASCADE;

CREATE TABLE public.ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  api_key TEXT,
  is_active BOOLEAN DEFAULT false,
  active_model TEXT,
  is_connected BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_ai_settings_user_id ON public.ai_settings(user_id);

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own AI settings"
  ON public.ai_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 3. LEADS TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.leads CASCADE;

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  website TEXT,
  niche TEXT,
  location TEXT,
  company_context TEXT,
  status TEXT DEFAULT 'new',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_user_id ON public.leads(user_id);
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_niche ON public.leads(niche);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own leads"
  ON public.leads FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 4. SENT EMAILS TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.sent_emails CASCADE;

CREATE TABLE public.sent_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'sent',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sent_emails_user_id ON public.sent_emails(user_id);
CREATE INDEX idx_sent_emails_lead_id ON public.sent_emails(lead_id);
CREATE INDEX idx_sent_emails_status ON public.sent_emails(status);

ALTER TABLE public.sent_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own sent emails"
  ON public.sent_emails FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 5. EMAIL REPLIES TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.email_replies CASCADE;

CREATE TABLE public.email_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  sent_email_id UUID REFERENCES public.sent_emails(id) ON DELETE SET NULL,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sentiment TEXT,
  is_positive BOOLEAN DEFAULT false,
  ai_response_generated BOOLEAN DEFAULT false,
  ai_response_sent BOOLEAN DEFAULT false,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_replies_user_id ON public.email_replies(user_id);
CREATE INDEX idx_email_replies_lead_id ON public.email_replies(lead_id);

ALTER TABLE public.email_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own email replies"
  ON public.email_replies FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 6. AI REPLIES TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.ai_replies CASCADE;

CREATE TABLE public.ai_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reply_id UUID REFERENCES public.email_replies(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  tone TEXT,
  model_used TEXT,
  status TEXT DEFAULT 'draft',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_replies_user_id ON public.ai_replies(user_id);
CREATE INDEX idx_ai_replies_reply_id ON public.ai_replies(reply_id);

ALTER TABLE public.ai_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own AI replies"
  ON public.ai_replies FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 7. GENERATED EMAILS TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.generated_emails CASCADE;

CREATE TABLE public.generated_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  tone TEXT,
  model_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_generated_emails_user_id ON public.generated_emails(user_id);
CREATE INDEX idx_generated_emails_lead_id ON public.generated_emails(lead_id);

ALTER TABLE public.generated_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own generated emails"
  ON public.generated_emails FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 8. INBOX CONFIGURATIONS TABLE
-- ============================================================================
DROP TABLE IF EXISTS public.inbox_configurations CASCADE;

CREATE TABLE public.inbox_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  password TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_checked TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, email)
);

CREATE INDEX idx_inbox_configurations_user_id ON public.inbox_configurations(user_id);

ALTER TABLE public.inbox_configurations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own inbox configurations"
  ON public.inbox_configurations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT 
  '✅ Database setup complete!' as message,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (
    'smtp_accounts', 'ai_settings', 'leads', 'sent_emails', 
    'email_replies', 'ai_replies', 'generated_emails', 'inbox_configurations'
  )) as tables_created;
