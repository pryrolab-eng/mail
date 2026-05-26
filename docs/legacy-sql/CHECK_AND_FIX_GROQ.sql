-- Step 1: Check current AI settings
SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  LEFT(api_key, 10) || '...' as api_key_preview,
  LENGTH(api_key) as api_key_length,
  created_at
FROM ai_settings
WHERE provider = 'groq';

-- Step 2: Get your user ID (if you need it)
SELECT id, email FROM auth.users;

-- Step 3: Fix common issues
-- Replace YOUR_USER_ID and YOUR_GROQ_API_KEY with actual values

-- Option A: If you have a Groq entry but wrong API key or model
UPDATE ai_settings
SET 
  api_key = 'YOUR_GROQ_API_KEY',  -- Get from https://console.groq.com/keys
  active_model = 'llama-3.3-70b-versatile',
  is_active = true
WHERE user_id = 'YOUR_USER_ID'::uuid 
  AND provider = 'groq';

-- Option B: If you don't have a Groq entry at all
INSERT INTO ai_settings (
  user_id,
  provider,
  api_key,
  active_model,
  is_active
) VALUES (
  'YOUR_USER_ID'::uuid,
  'groq',
  'YOUR_GROQ_API_KEY',  -- Get from https://console.groq.com/keys
  'llama-3.3-70b-versatile',
  true
)
ON CONFLICT (user_id, provider) 
DO UPDATE SET
  api_key = EXCLUDED.api_key,
  active_model = EXCLUDED.active_model,
  is_active = true;

-- Step 4: Verify the fix
SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  LEFT(api_key, 10) || '...' as api_key_preview,
  LENGTH(api_key) as api_key_length
FROM ai_settings
WHERE provider = 'groq' AND user_id = 'YOUR_USER_ID'::uuid;

-- Common Groq API Key Issues:
-- 1. API key should start with "gsk_"
-- 2. API key should be around 56 characters long
-- 3. Get your key from: https://console.groq.com/keys
-- 4. Make sure you're using a valid model name

-- Valid Groq Models (as of 2024):
-- - llama-3.3-70b-versatile (RECOMMENDED - fastest and best)
-- - llama-3.1-70b-versatile
-- - llama-3.1-8b-instant
-- - mixtral-8x7b-32768
-- - gemma2-9b-it
