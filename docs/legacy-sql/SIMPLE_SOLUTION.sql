-- SIMPLE SOLUTION: The AI provider already exists for the correct user!
-- Just verify it's there:

SELECT 
  user_id,
  provider,
  model_name,
  is_active,
  LEFT(api_key, 10) || '...' as api_key_preview,
  '✅ This is your AI provider' as status
FROM public.ai_providers
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;

-- If you see a result above, the AI provider IS configured!
-- The issue is your app session has a different user ID.

-- SOLUTION: Log out and log back in
-- Your app will then use user_id: 91416b57-9f98-4612-b88a-8ac157f31a73
-- And the AI provider will be found!
