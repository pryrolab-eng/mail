-- Fix: Add AI Provider for the CORRECT user
-- Your actual logged-in user ID: eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae

-- Option 1: Move the existing AI provider to the correct user
UPDATE public.ai_providers
SET user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;

-- Option 2: Or just insert a new one for the correct user
-- (Uncomment if you prefer this approach)
/*
INSERT INTO public.ai_providers (
  user_id,
  provider,
  api_key,
  model_name,
  is_active
) VALUES (
  'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid,
  'groq',
  'YOUR_GROQ_API_KEY_HERE',
  'llama-3.3-70b-versatile',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET is_active = true, api_key = EXCLUDED.api_key;
*/

-- Verify it worked
SELECT 
  user_id,
  provider,
  model_name,
  is_active,
  '✅ Fixed!' as status
FROM public.ai_providers
WHERE user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid;
