-- Comprehensive Check for Leads Table Issues
-- Run this to diagnose the "Failed to add to CRM" error

-- ============================================
-- 1. Check if leads table exists
-- ============================================
SELECT 
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'leads')
    THEN '✅ Leads table exists'
    ELSE '❌ Leads table does NOT exist'
  END as table_status;

-- ============================================
-- 2. Check all columns in leads table
-- ============================================
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'leads'
ORDER BY ordinal_position;

-- ============================================
-- 3. Check RLS (Row Level Security) status
-- ============================================
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'leads';

-- ============================================
-- 4. Check RLS policies
-- ============================================
SELECT 
  policyname as policy_name,
  cmd as command,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'leads';

-- ============================================
-- 5. Check if you have any users
-- ============================================
SELECT 
  id,
  email,
  created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- ============================================
-- 6. Test insert with your user ID
-- ============================================
-- First, get your user ID from step 5 above, then uncomment and run:

/*
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get first user
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at DESC LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found';
  END IF;
  
  RAISE NOTICE 'Testing insert for user: %', v_user_id;
  
  -- Try to insert a test lead
  INSERT INTO public.leads (
    user_id,
    company_name,
    email,
    niche,
    location,
    company_context,
    status,
    category,
    source,
    tags
  ) VALUES (
    v_user_id,
    'Test Company ' || NOW(),
    'test' || EXTRACT(EPOCH FROM NOW()) || '@example.com',
    'Test Niche',
    'Test Location',
    'Test context',
    'New',
    'Test Category',
    'scraper',
    ARRAY['test1', 'test2']
  );
  
  RAISE NOTICE 'Insert successful!';
  
  -- Clean up
  DELETE FROM public.leads 
  WHERE company_name LIKE 'Test Company%' 
  AND email LIKE 'test%@example.com';
  
  RAISE NOTICE 'Test complete and cleaned up';
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Insert failed with error: %', SQLERRM;
END $$;
*/

-- ============================================
-- 7. Check for missing RLS policies
-- ============================================
SELECT 
  CASE 
    WHEN EXISTS(
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'leads' 
      AND cmd = 'INSERT'
    )
    THEN '✅ INSERT policy exists'
    ELSE '❌ No INSERT policy found - this is likely the problem!'
  END as insert_policy_status;

-- ============================================
-- 8. If INSERT policy is missing, create it
-- ============================================
-- Uncomment and run if step 7 shows missing policy:

/*
-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can insert own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can view own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can update own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can delete own leads" ON public.leads;

-- Create comprehensive RLS policies
CREATE POLICY "Users can insert own leads" ON public.leads
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own leads" ON public.leads
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own leads" ON public.leads
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own leads" ON public.leads
  FOR DELETE
  USING (auth.uid() = user_id);

SELECT '✅ RLS policies created successfully!' as status;
*/

-- ============================================
-- SUMMARY
-- ============================================
SELECT 
  '🔍 Check complete!' as status,
  'Review the results above to identify the issue' as next_step;
