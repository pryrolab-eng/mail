-- Debug: Check AI Provider Configuration

-- 1. Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'ai_providers'
) as table_exists;

-- 2. Show ALL providers (active and inactive)
SELECT 
  user_id,
  provider,
  model_name,
  is_active,
  LEFT(api_key, 10) || '...' as api_key_preview,
  created_at,
  updated_at
FROM public.ai_providers
ORDER BY created_at DESC;

-- 3. Check specifically for your user ID
SELECT 
  user_id,
  provider,
  model_name,
  is_active,
  'Found for your user!' as status
FROM public.ai_providers
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;

-- 4. Check what the app query would return (simulating the app's query)
SELECT *
FROM public.ai_providers
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid
  AND is_active = true;

-- 5. Check all users in auth.users
SELECT 
  id,
  email,
  created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 10;
