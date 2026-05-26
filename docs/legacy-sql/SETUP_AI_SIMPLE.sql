-- Simple AI Provider Setup
-- Step 1: Run this to get your user ID

SELECT 
  id as user_id,
  email,
  '👆 Copy this user_id for next step' as instruction
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- Step 2: Copy your user_id from above, then run the INSERT below
-- Replace 'YOUR_USER_ID_HERE' with the actual UUID from above
-- Replace 'YOUR_API_KEY_HERE' with your actual API key

-- Create table if needed
CREATE TABLE IF NOT EXISTS public.ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  api_key TEXT NOT NULL,
  model_name VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can view their own AI providers"
  ON public.ai_providers FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can insert their own AI providers"
  ON public.ai_providers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can update their own AI providers"
  ON public.ai_providers FOR UPDATE
  USING (auth.uid() = user_id);

-- Step 3: Choose ONE option below and uncomment it

-- OPTION 1: Groq (FREE & FAST) ⭐ RECOMMENDED
-- Get free API key: https://console.groq.com/keys
/*
INSERT INTO public.ai_providers (user_id, provider, api_key, model_name, is_active)
VALUES (
  'YOUR_USER_ID_HERE'::uuid,
  'groq',
  'gsk_YOUR_GROQ_API_KEY_HERE',
  'llama-3.3-70b-versatile',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET api_key = EXCLUDED.api_key, model_name = EXCLUDED.model_name, is_active = true;
*/

-- OPTION 2: OpenAI (GPT-4)
-- Get API key: https://platform.openai.com/api-keys
/*
INSERT INTO public.ai_providers (user_id, provider, api_key, model_name, is_active)
VALUES (
  'YOUR_USER_ID_HERE'::uuid,
  'openai',
  'sk-YOUR_OPENAI_API_KEY_HERE',
  'gpt-4o-mini',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET api_key = EXCLUDED.api_key, model_name = EXCLUDED.model_name, is_active = true;
*/

-- OPTION 3: Anthropic (Claude)
-- Get API key: https://console.anthropic.com/
/*
INSERT INTO public.ai_providers (user_id, provider, api_key, model_name, is_active)
VALUES (
  'YOUR_USER_ID_HERE'::uuid,
  'anthropic',
  'sk-ant-YOUR_ANTHROPIC_API_KEY_HERE',
  'claude-3-5-sonnet-20241022',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET api_key = EXCLUDED.api_key, model_name = EXCLUDED.model_name, is_active = true;
*/

-- Step 4: Verify it worked
SELECT 
  provider,
  model_name,
  is_active,
  '✅ Configured' as status
FROM public.ai_providers;
