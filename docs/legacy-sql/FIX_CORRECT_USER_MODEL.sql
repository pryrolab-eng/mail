-- Fix the model name for the ACTUAL app user
-- User: eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae

UPDATE public.ai_settings
SET active_model = 'llama-3.3-70b-versatile'
WHERE user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid;

-- Verify
SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  '✅ Fixed for app user!' as status
FROM public.ai_settings
WHERE user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid;

-- Show all AI settings
SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  created_at
FROM public.ai_settings
ORDER BY created_at DESC;
