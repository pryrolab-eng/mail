-- Check if AI providers table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'ai_providers'
) as table_exists;

-- If it exists, show structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'ai_providers'
ORDER BY ordinal_position;

-- Show existing AI providers
SELECT 
  provider,
  model_name,
  is_active,
  created_at
FROM public.ai_providers
WHERE is_active = true;

-- Get your user ID
SELECT 
  id as user_id,
  email,
  '👆 Use this user_id to add AI provider' as instruction
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;
