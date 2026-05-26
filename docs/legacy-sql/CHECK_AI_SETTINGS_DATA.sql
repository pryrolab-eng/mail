-- Check data in ai_settings table

SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  is_connected,
  LEFT(api_key, 10) || '...' as api_key_preview,
  created_at
FROM public.ai_settings
ORDER BY created_at DESC;

-- Check if data exists for the app user
SELECT 
  *,
  'This is for the app user' as note
FROM public.ai_settings
WHERE user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid;

-- Check if data exists for the SQL user
SELECT 
  *,
  'This is for the SQL user' as note
FROM public.ai_settings
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;
