-- Fix AI Provider User ID Mismatch
-- Use this if the authenticated user ID is different from what we inserted

-- Step 1: Check all users
SELECT 
  id,
  email,
  created_at,
  'Copy the correct user_id' as instruction
FROM auth.users
ORDER BY created_at DESC;

-- Step 2: Update the AI provider to the correct user
-- Replace NEW_USER_ID_HERE with the authenticated user ID from the console

UPDATE public.ai_providers
SET user_id = 'NEW_USER_ID_HERE'::uuid
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;

-- Step 3: Verify the update
SELECT 
  user_id,
  provider,
  model_name,
  is_active,
  '✅ Updated!' as status
FROM public.ai_providers
WHERE is_active = true;

-- Alternative: If you want to just insert for the new user instead
/*
INSERT INTO public.ai_providers (
  user_id,
  provider,
  api_key,
  model_name,
  is_active
) VALUES (
  'NEW_USER_ID_HERE'::uuid,
  'groq',
  'YOUR_GROQ_API_KEY',
  'llama-3.3-70b-versatile',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET 
  api_key = EXCLUDED.api_key,
  model_name = EXCLUDED.model_name,
  is_active = true,
  updated_at = NOW();
*/
