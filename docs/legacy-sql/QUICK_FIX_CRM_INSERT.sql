-- Quick Fix for CRM Insert Issue
-- Run this entire script in Supabase SQL Editor

-- ============================================
-- Step 1: Verify RLS policies exist
-- ============================================
SELECT 
  policyname,
  cmd,
  'Exists ✅' as status
FROM pg_policies
WHERE tablename = 'leads'
ORDER BY cmd;

-- If you see 4 policies (INSERT, SELECT, UPDATE, DELETE), skip to Step 3
-- If you see fewer than 4, continue to Step 2

-- ============================================
-- Step 2: Recreate RLS policies (if missing)
-- ============================================
-- Uncomment and run if Step 1 shows missing policies:

/*
-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view their own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can insert their own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can update their own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can delete their own leads" ON public.leads;

-- Recreate policies
CREATE POLICY "Users can view their own leads"
  ON public.leads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own leads"
  ON public.leads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own leads"
  ON public.leads FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own leads"
  ON public.leads FOR DELETE
  USING (auth.uid() = user_id);

SELECT '✅ RLS policies recreated' as status;
*/

-- ============================================
-- Step 3: Ensure all required columns exist
-- ============================================
DO $$
BEGIN
  -- Add category if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'leads' AND column_name = 'category'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN category TEXT;
    RAISE NOTICE 'Added category column';
  END IF;

  -- Add source if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'leads' AND column_name = 'source'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN source TEXT DEFAULT 'manual';
    RAISE NOTICE 'Added source column';
  END IF;

  -- Add tags if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'leads' AND column_name = 'tags'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN tags TEXT[];
    RAISE NOTICE 'Added tags column';
  END IF;

  RAISE NOTICE '✅ All columns verified';
END $$;

-- ============================================
-- Step 4: Test insert with actual user
-- ============================================
DO $$
DECLARE
  v_user_id UUID;
  v_test_email TEXT;
BEGIN
  -- Get the first user
  SELECT id INTO v_user_id 
  FROM auth.users 
  ORDER BY created_at DESC 
  LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION '❌ No users found! Please sign up first at /sign-up';
  END IF;
  
  RAISE NOTICE 'Testing with user: %', v_user_id;
  
  -- Generate unique test email
  v_test_email := 'test_' || EXTRACT(EPOCH FROM NOW())::TEXT || '@example.com';
  
  -- Try insert
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
    'Test Company',
    v_test_email,
    'Test Niche',
    'Test Location',
    'Test context for company',
    'New',
    'Test Category',
    'scraper',
    ARRAY['test', 'scraper']
  );
  
  RAISE NOTICE '✅ Insert successful!';
  
  -- Clean up
  DELETE FROM public.leads WHERE email = v_test_email;
  RAISE NOTICE '✅ Test cleaned up';
  
EXCEPTION 
  WHEN OTHERS THEN
    RAISE NOTICE '❌ Insert failed: %', SQLERRM;
    RAISE NOTICE 'Error detail: %', SQLSTATE;
END $$;

-- ============================================
-- Step 5: Final verification
-- ============================================
SELECT 
  '✅ Setup complete!' as status,
  'Try adding to CRM again in your app' as next_step,
  'If still failing, check browser console for detailed error' as note;

-- ============================================
-- Bonus: View current leads count
-- ============================================
SELECT 
  COUNT(*) as total_leads,
  COUNT(DISTINCT user_id) as unique_users
FROM public.leads;
