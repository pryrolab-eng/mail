-- Hybrid lead agent: evidence memory, contact verification, and agent settings.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS agent_confidence TEXT,
  ADD COLUMN IF NOT EXISTS agent_risk TEXT,
  ADD COLUMN IF NOT EXISTS agent_recommended_action TEXT,
  ADD COLUMN IF NOT EXISTS agent_email_angle TEXT,
  ADD COLUMN IF NOT EXISTS agent_draft_allowed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_auto_send_allowed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_last_run_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.agent_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  product_shape TEXT NOT NULL DEFAULT 'hybrid',
  autonomy_mode TEXT NOT NULL DEFAULT 'semi_auto',
  search_provider TEXT NOT NULL DEFAULT 'free',
  ai_provider TEXT NOT NULL DEFAULT 'groq',
  min_auto_send_score INTEGER NOT NULL DEFAULT 85,
  min_draft_score INTEGER NOT NULL DEFAULT 65,
  require_verified_email_for_auto_send BOOLEAN NOT NULL DEFAULT true,
  allow_directory_evidence_for_drafts BOOLEAN NOT NULL DEFAULT true,
  allow_guessed_email_auto_send BOOLEAN NOT NULL DEFAULT false,
  browser_fallback_enabled BOOLEAN NOT NULL DEFAULT true,
  evidence_cache_ttl_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL DEFAULT 'research',
  status TEXT NOT NULL DEFAULT 'completed',
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  model_used TEXT,
  search_cost INTEGER NOT NULL DEFAULT 0,
  token_cost INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.lead_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  extracted_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence TEXT NOT NULL DEFAULT 'low',
  is_official_candidate BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contact_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  agent_run_id UUID REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  contact_type TEXT NOT NULL,
  value TEXT NOT NULL,
  source_url TEXT,
  source_type TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  confidence TEXT NOT NULL DEFAULT 'low',
  is_business_owned BOOLEAN NOT NULL DEFAULT false,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, lead_id, contact_type, value)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_lead
  ON public.agent_runs(user_id, lead_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_evidence_lead
  ON public.lead_evidence(user_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_points_lead
  ON public.contact_points(user_id, lead_id, contact_type, is_primary DESC);
CREATE INDEX IF NOT EXISTS idx_contact_points_value
  ON public.contact_points(user_id, contact_type, value);

ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own agent settings" ON public.agent_settings;
CREATE POLICY "Users manage own agent settings"
  ON public.agent_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own agent runs" ON public.agent_runs;
CREATE POLICY "Users manage own agent runs"
  ON public.agent_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own lead evidence" ON public.lead_evidence;
CREATE POLICY "Users manage own lead evidence"
  ON public.lead_evidence FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own contact points" ON public.contact_points;
CREATE POLICY "Users manage own contact points"
  ON public.contact_points FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS touch_agent_settings_updated_at ON public.agent_settings;
CREATE TRIGGER touch_agent_settings_updated_at
  BEFORE UPDATE ON public.agent_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS touch_contact_points_updated_at ON public.contact_points;
CREATE TRIGGER touch_contact_points_updated_at
  BEFORE UPDATE ON public.contact_points
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
