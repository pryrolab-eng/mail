-- Check auth.users table

-- 1. List all users in auth.users
SELECT 
  id,
  email,
  created_at,
  '👆 These are the users in auth.users' as note
FROM auth.users
ORDER BY created_at DESC;

-- 2. Check if the logged-in user exists
SELECT 
  id,
  email,
  'Found!' as status
FROM auth.users
WHERE id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid;

-- 3. Check the foreign key constraint
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'ai_providers'
  AND tc.constraint_type = 'FOREIGN KEY';

-- 4. If the user doesn't exist in auth.users, we need to either:
--    A) Drop the foreign key constraint temporarily, OR
--    B) Use the correct user ID that exists in auth.users

-- Option A: Drop foreign key (temporary fix)
-- ALTER TABLE public.ai_providers DROP CONSTRAINT IF EXISTS ai_providers_user_id_fkey;

-- Option B: Check what user IDs actually exist and use one of those
SELECT 
  id,
  email,
  '👆 Use one of these user IDs' as instruction
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;
