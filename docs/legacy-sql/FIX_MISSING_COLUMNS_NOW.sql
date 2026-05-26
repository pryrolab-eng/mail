-- ============================================================================
-- FIX: Add ALL missing columns to leads table + Force schema refresh
-- Run this ENTIRE script in Supabase SQL Editor
-- ============================================================================

-- Step 1: Add all missing columns that the scraper needs
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Step 2: Verify columns were added
SELECT 
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'leads'
  AND column_name IN (
    'confidence_score', 
    'source', 
    'tags', 
    'email_verified', 
    'last_contacted_at',
    'phone',
    'website',
    'category'
  )
ORDER BY column_name;

-- Step 3: Force PostgREST (Supabase API) to reload the schema
NOTIFY pgrst, 'reload schema';

-- Step 4: Show success message
SELECT 
  '✅ All columns added successfully!' as status,
  '🔄 Schema cache refresh triggered' as cache_status,
  'Try adding scraped data again in 5-10 seconds' as next_step;
