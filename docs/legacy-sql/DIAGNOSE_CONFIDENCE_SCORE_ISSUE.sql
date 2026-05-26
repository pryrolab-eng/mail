-- ============================================================================
-- DIAGNOSE: Check if confidence_score column exists in your database
-- Run this in Supabase SQL Editor to see what's actually in your database
-- ============================================================================

-- 1. Check if leads table exists
SELECT 
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads')
    THEN '✅ Leads table exists'
    ELSE '❌ Leads table does NOT exist'
  END as table_status;

-- 2. List ALL columns currently in the leads table
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'leads'
ORDER BY ordinal_position;

-- 3. Specifically check for the columns the scraper needs
SELECT 
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'confidence_score')
    THEN '✅ confidence_score exists'
    ELSE '❌ confidence_score MISSING'
  END as confidence_score_status,
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'source')
    THEN '✅ source exists'
    ELSE '❌ source MISSING'
  END as source_status,
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'email_verified')
    THEN '✅ email_verified exists'
    ELSE '❌ email_verified MISSING'
  END as email_verified_status,
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'tags')
    THEN '✅ tags exists'
    ELSE '❌ tags MISSING'
  END as tags_status,
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'last_contacted_at')
    THEN '✅ last_contacted_at exists'
    ELSE '❌ last_contacted_at MISSING'
  END as last_contacted_at_status;

-- 4. Show a sample of existing data (if any)
SELECT 
  COUNT(*) as total_leads,
  COUNT(DISTINCT user_id) as total_users
FROM public.leads;

-- 5. Summary
SELECT '🔍 Diagnostic complete! Check the results above.' as status;
