-- Force Schema Refresh for Leads Table
-- Run this in Supabase SQL Editor

-- ============================================
-- Step 1: Add columns if they don't exist
-- ============================================
DO $$
BEGIN
  -- Add category column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'leads' 
    AND column_name = 'category'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN category TEXT;
    RAISE NOTICE '✅ Added category column';
  ELSE
    RAISE NOTICE '✓ category column already exists';
  END IF;

  -- Add source column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'leads' 
    AND column_name = 'source'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN source TEXT DEFAULT 'manual';
    RAISE NOTICE '✅ Added source column';
  ELSE
    RAISE NOTICE '✓ source column already exists';
  END IF;

  -- Add tags column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'leads' 
    AND column_name = 'tags'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN tags TEXT[];
    RAISE NOTICE '✅ Added tags column';
  ELSE
    RAISE NOTICE '✓ tags column already exists';
  END IF;
END $$;

-- ============================================
-- Step 2: Verify columns exist
-- ============================================
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'leads'
  AND column_name IN ('category', 'source', 'tags')
ORDER BY column_name;

-- ============================================
-- Step 3: Force PostgREST schema cache reload
-- ============================================
-- This notifies PostgREST to reload the schema
NOTIFY pgrst, 'reload schema';

SELECT '✅ Schema cache reload triggered' as status;

-- ============================================
-- Step 4: Grant permissions (just in case)
-- ============================================
GRANT ALL ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;

SELECT '✅ Permissions granted' as status;

-- ============================================
-- Step 5: Show final table structure
-- ============================================
SELECT 
  '✅ COMPLETE TABLE STRUCTURE:' as info;

SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'leads'
ORDER BY ordinal_position;
