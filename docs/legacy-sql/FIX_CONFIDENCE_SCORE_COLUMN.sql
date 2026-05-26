-- ============================================================================
-- FIX: Add missing confidence_score column to leads table
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Add the confidence_score column if it doesn't exist
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 0;

-- Also add other related columns that might be missing from the scraper
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

-- Verify the column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'leads'
  AND column_name IN ('confidence_score', 'source', 'tags', 'email_verified', 'last_contacted_at')
ORDER BY column_name;

-- Show success message
SELECT '✅ confidence_score and related columns added successfully!' as message;
