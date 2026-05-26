-- Future hybrid skill overrides. V1 is read-only and does not edit prompts.

CREATE TABLE IF NOT EXISTS public.agent_skill_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  skill_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  version_pin TEXT,
  prompt_override TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill_id)
);

ALTER TABLE public.agent_skill_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own agent skill overrides" ON public.agent_skill_overrides;
CREATE POLICY "Users manage own agent skill overrides"
  ON public.agent_skill_overrides FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS touch_agent_skill_overrides_updated_at ON public.agent_skill_overrides;
CREATE TRIGGER touch_agent_skill_overrides_updated_at
  BEFORE UPDATE ON public.agent_skill_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
