-- Add AI Provider
-- Step 1: Get your user ID

SELECT 
  id as user_id,
  email,
  '👆 Copy this user_id for next step' as instruction
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- Step 2: Choose ONE option below and replace the values

-- OPTION 1: Groq (FREE & FAST) ⭐ RECOMMENDED
-- Get free API key: https://console.groq.com/keys
-- Takes 30 seconds to sign up!

INSERT INTO public.ai_providers (
  user_id,
  provider,
  api_key,
  model_name,
  is_active
) VALUES (
  'YOUR_USER_ID_HERE'::uuid,           -- Replace with your user_id from above
  'groq',                              -- Provider name
  'gsk_YOUR_GROQ_API_KEY_HERE',       -- Get from https://console.groq.com/keys
  'llama-3.3-70b-versatile',          -- Model name
  true                                 -- Active
)
ON CONFLICT (user_id, provider) DO UPDATE
SET 
  api_key = EXCLUDED.api_key,
  model_name = EXCLUDED.model_name,
  is_active = true,
  updated_at = NOW();

-- OPTION 2: OpenAI (GPT-4) - Best quality but costs money
-- Get API key: https://platform.openai.com/api-keys
/*
INSERT INTO public.ai_providers (
  user_id,
  provider,
  api_key,
  model_name,
  is_active
) VALUES (
  'YOUR_USER_ID_HERE'::uuid,
  'openai',
  'sk-YOUR_OPENAI_API_KEY_HERE',
  'gpt-4o-mini',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET 
  api_key = EXCLUDED.api_key,
  model_name = EXCLUDED.model_name,
  is_active = true,
  updated_at = NOW();
*/

-- Step 3: Verify it worked
SELECT 
  provider,
  model_name,
  is_active,
  '✅ AI Provider configured!' as status
FROM public.ai_providers
WHERE is_active = true;

-- Instructions
SELECT '
🤖 AI PROVIDER SETUP

RECOMMENDED: Groq (FREE)
1. Go to: https://console.groq.com/keys
2. Sign up (takes 30 seconds)
3. Click "Create API Key"
4. Copy the key (starts with gsk_)
5. Paste it above in api_key field
6. Replace YOUR_USER_ID_HERE with your user_id
7. Run this script again

Your API key format: gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

After setup, try generating emails again!
' as instructions;
