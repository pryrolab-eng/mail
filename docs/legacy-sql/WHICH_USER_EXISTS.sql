-- Check which user ID actually exists in auth.users

SELECT 
  id,
  email,
  created_at,
  CASE 
    WHEN id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid THEN '👈 This is what the app shows'
    WHEN id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid THEN '👈 This is what SQL showed before'
    ELSE ''
  END as note
FROM auth.users
ORDER BY created_at DESC;

-- Check AI providers
SELECT 
  user_id,
  provider,
  model_name,
  is_active,
  'Current AI provider' as note
FROM public.ai_providers;
