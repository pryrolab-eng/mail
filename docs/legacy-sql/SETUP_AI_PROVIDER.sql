-- Quick AI Provider Setup
-- Run this in Supabase SQL Editor

-- Check if ai_providers table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'ai_providers'
) as table_exists;

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL, -- 'openai', 'anthropic', 'groq'
  api_key TEXT NOT NULL,
  model_name VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Enable RLS
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
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

DROP POLICY IF EXISTS "Users can delete their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can delete their own AI providers"
  ON public.ai_providers FOR DELETE
  USING (auth.uid() = user_id);

-- Add a default AI provider
-- OPTION 1: OpenAI (recommended)
-- OPTION 2: Groq (free, fast)
-- OPTION 3: Anthropic (Claude)

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get your user ID
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at DESC LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found. Please sign up first.';
  END IF;
  
  -- Insert AI provider (choose one option below)
  
  -- OPTION 1: OpenAI (GPT-4)
  -- Get API key from: https://platform.openai.com/api-keys
  INSERT INTO public.ai_providers (
    user_id,
    provider,
    api_key,
    model_name,
    is_active
  ) VALUES (
    v_user_id,
    'openai',
    'sk-your-openai-api-key-here', -- CHANGE THIS
    'gpt-4o-mini',
    true
  )
  ON CONFLICT (user_id, provider) DO UPDATE
  SET 
    api_key = EXCLUDED.api_key,
    model_name = EXCLUDED.model_name,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
  
  -- OPTION 2: Groq (Free & Fast)
  -- Get API key from: https://console.groq.com/keys
  /*
  INSERT INTO public.ai_providers (
    user_id,
    provider,
    api_key,
    model_name,
    is_active
  ) VALUES (
    v_user_id,
    'groq',
    'gsk_your-groq-api-key-here', -- CHANGE THIS
    'llama-3.3-70b-versatile',
    true
  )
  ON CONFLICT (user_id, provider) DO UPDATE
  SET 
    api_key = EXCLUDED.api_key,
    model_name = EXCLUDED.model_name,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
  */
  
  -- OPTION 3: Anthropic (Claude)
  -- Get API key from: https://console.anthropic.com/
  /*
  INSERT INTO public.ai_providers (
    user_id,
    provider,
    api_key,
    model_name,
    is_active
  ) VALUES (
    v_user_id,
    'anthropic',
    'sk-ant-your-anthropic-api-key-here', -- CHANGE THIS
    'claude-3-5-sonnet-20241022',
    true
  )
  ON CONFLICT (user_id, provider) DO UPDATE
  SET 
    api_key = EXCLUDED.api_key,
    model_name = EXCLUDED.model_name,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
  */
  
  RAISE NOTICE '✅ AI provider configured for user: %', v_user_id;
  RAISE NOTICE '⚠️  IMPORTANT: Update the API key above!';
END $$;

-- Verify the provider was added
SELECT 
  provider,
  model_name,
  is_active,
  CASE 
    WHEN api_key LIKE 'sk-%' THEN '✅ API key set'
    WHEN api_key LIKE 'gsk_%' THEN '✅ API key set'
    ELSE '❌ Update API key'
  END as api_key_status,
  created_at
FROM public.ai_providers
ORDER BY created_at DESC;

-- Instructions
SELECT '
🤖 AI PROVIDER SETUP

Choose one option:

1️⃣ OpenAI (GPT-4) - Best quality
   - Get key: https://platform.openai.com/api-keys
   - Model: gpt-4o-mini (cheap) or gpt-4o (best)
   - Cost: ~$0.15 per 1000 emails

2️⃣ Groq (Llama 3.3) - FREE & Fast
   - Get key: https://console.groq.com/keys
   - Model: llama-3.3-70b-versatile
   - Cost: FREE (rate limited)

3️⃣ Anthropic (Claude) - Great quality
   - Get key: https://console.anthropic.com/
   - Model: claude-3-5-sonnet-20241022
   - Cost: ~$0.30 per 1000 emails

After getting your API key:
1. Uncomment the option you want in this script
2. Replace the api_key with your actual key
3. Run this script again
4. Try generating emails!
' as instructions;
