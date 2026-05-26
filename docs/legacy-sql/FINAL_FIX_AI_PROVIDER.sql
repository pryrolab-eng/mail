-- FINAL FIX: Update AI provider to correct user
-- The real logged-in user is: eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae

-- Step 1: Check both users exist
SELECT id, email, 'User in auth.users' as note
FROM auth.users
WHERE id IN (
  '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid,
  'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid
);

-- Step 2: Check current AI providers
SELECT user_id, provider, model_name, is_active
FROM public.ai_providers;

-- Step 3: Delete the wrong one and insert for the correct user
DELETE FROM public.ai_providers 
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;

INSERT INTO public.ai_providers (
  user_id,
  provider,
  api_key,
  model_name,
  is_active
) VALUES (
  'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid,
  'groq',
  'YOUR_GROQ_API_KEY_HERE',  -- ⚠️ REPLACE WITH YOUR ACTUAL GROQ API KEY
  'llama-3.3-70b-versatile',
  true
);

-- Step 4: Verify
SELECT 
  user_id,
  provider,
  model_name,
  is_active,
  '✅ Fixed for correct user!' as status
FROM public.ai_providers
WHERE user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid;
