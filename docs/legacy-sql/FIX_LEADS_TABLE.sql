-- Fix for "Failed to add to CRM" error
-- This ensures the leads table has all required columns without conflicts

-- Check current columns
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'leads'
ORDER BY ordinal_position;

-- Make sure all columns exist with correct types
-- These are safe to run multiple times (IF NOT EXISTS)

DO $$
BEGIN
  -- Add category if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'leads' AND column_name = 'category'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN category TEXT;
  END IF;

  -- Add source if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'leads' AND column_name = 'source'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN source TEXT DEFAULT 'manual';
  END IF;

  -- Add tags if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'leads' AND column_name = 'tags'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN tags TEXT[];
  END IF;
END $$;

-- Verify all columns exist
SELECT 
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'category')
    THEN '✅ category exists'
    ELSE '❌ category missing'
  END as category_status,
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'source')
    THEN '✅ source exists'
    ELSE '❌ source missing'
  END as source_status,
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'tags')
    THEN '✅ tags exists'
    ELSE '❌ tags missing'
  END as tags_status;

-- Test insert (will show the actual error if there is one)
-- Replace YOUR_USER_ID with your actual user ID
/*
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
  'YOUR_USER_ID',
  'Test Company',
  'test@example.com',
  'Test Niche',
  'Test Location',
  'Test context',
  'New',
  'Test Category',
  'scraper',
  ARRAY['tag1', 'tag2']
);

-- If successful, delete the test record
DELETE FROM public.leads WHERE company_name = 'Test Company' AND email = 'test@example.com';
*/

SELECT '✅ Fix complete! Try adding to CRM again.' as status;
