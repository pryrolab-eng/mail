-- 🚀 QUICK AI SETUP - Fix "No active AI provider" Error
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/YOUR_PROJECT/sql

-- ============================================
-- STEP 1: Get Your User ID (RUN THIS FIRST!)
-- ============================================
-- Copy the result and use it in Step 2

SELECT 
  id as user_id,
  email,
  '👆 COPY THIS user_id for Step 2' as instruction
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- ⚠️ STOP! Don't run Step 2 until you have:
-- 1. Your user_id from above
-- 2. Your Groq API key from https://console.groq.com/keys

-- ============================================
-- STEP 2: Add AI Provider (Choose ONE option)
-- ============================================

-- ⭐ OPTION 1: Groq (FREE & FAST) - RECOMMENDED
-- Get free API key in 30 seconds: https://console.groq.com/keys

INSERT INTO public.ai_providers (
  user_id,
  provider,
  api_key,
  model_name,
  is_active
) VALUES (
  'YOUR_USER_ID_HERE'::uuid,           -- ⚠️ Replace with user_id from Step 1
  'groq',
  'gsk_YOUR_API_KEY_HERE',             -- ⚠️ Replace with your Groq API key
  'llama-3.3-70b-versatile',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET 
  api_key = EXCLUDED.api_key,
  model_name = EXCLUDED.model_name,
  is_active = true,
  updated_at = NOW();

-- OPTION 2: OpenAI (Costs money but best quality)
-- Uncomment below if you prefer OpenAI
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
  'sk-YOUR_OPENAI_KEY_HERE',
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

-- ============================================
-- STEP 3: Verify Setup
-- ============================================
SELECT 
  provider,
  model_name,
  is_active,
  created_at,
  '✅ AI Provider Active!' as status
FROM public.ai_providers
WHERE is_active = true;

-- ============================================
-- 📋 INSTRUCTIONS
-- ============================================
SELECT '
🎯 HOW TO FIX THE ERROR:

1️⃣ Run STEP 1 above → Copy your user_id

2️⃣ Get a FREE Groq API key:
   • Go to: https://console.groq.com/keys
   • Sign up (30 seconds)
   • Click "Create API Key"
   • Copy the key (starts with gsk_)

3️⃣ In STEP 2 above:
   • Replace YOUR_USER_ID_HERE with your actual user_id
   • Replace gsk_YOUR_API_KEY_HERE with your Groq API key

4️⃣ Run STEP 2 to insert the provider

5️⃣ Run STEP 3 to verify

6️⃣ Refresh your app and try generating emails again!

✨ Done! Your AI email generation will now work.
' as instructions;
