-- Check Row Level Security on ai_providers table

-- 1. Check if RLS is enabled
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'ai_providers';

-- 2. Show all policies on ai_providers
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'ai_providers';

-- 3. If no results above, RLS might not be set up
-- Try to grant access and disable RLS temporarily for testing:

-- Disable RLS (for testing only!)
ALTER TABLE public.ai_providers DISABLE ROW LEVEL SECURITY;

-- Then try your app again
