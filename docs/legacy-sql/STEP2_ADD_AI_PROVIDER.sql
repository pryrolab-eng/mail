-- STEP 2: Add AI Provider
-- ⚠️ BEFORE running this, you MUST:
-- 1. Have your user_id from STEP1_GET_USER_ID.sql
-- 2. Have your Groq API key from https://console.groq.com/keys

-- Replace BOTH placeholders below, then run this:

INSERT INTO public.ai_providers (
  user_id,
  provider,
  api_key,
  model_name,
  is_active
) VALUES (
  'PASTE_YOUR_USER_ID_HERE'::uuid,    -- Example: '12345678-1234-1234-1234-123456789abc'
  'groq',
  'PASTE_YOUR_GROQ_KEY_HERE',         -- Example: 'gsk_abc123...'
  'llama-3.3-70b-versatile',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET 
  api_key = EXCLUDED.api_key,
  model_name = EXCLUDED.model_name,
  is_active = true,
  updated_at = NOW();

-- After running, verify it worked:
SELECT 
  provider,
  model_name,
  is_active,
  '✅ AI Provider Active!' as status
FROM public.ai_providers
WHERE is_active = true;
