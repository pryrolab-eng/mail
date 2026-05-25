-- Create AI Providers table
CREATE TABLE IF NOT EXISTS public.ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'groq')),
  api_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Enable RLS
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (idempotent)
DROP POLICY IF EXISTS "Users can view their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can view their own AI providers"
  ON public.ai_providers FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can insert their own AI providers"
  ON public.ai_providers FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can update their own AI providers"
  ON public.ai_providers FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can delete their own AI providers"
  ON public.ai_providers FOR DELETE USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_ai_providers_user_id ON public.ai_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_providers_active ON public.ai_providers(user_id, is_active) WHERE is_active = true;
