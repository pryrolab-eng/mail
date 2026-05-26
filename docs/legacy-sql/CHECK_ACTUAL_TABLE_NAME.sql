-- Check what AI-related tables actually exist

SELECT 
  table_name,
  '👈 This is the actual table name' as note
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE '%ai%'
ORDER BY table_name;

-- Check ai_settings table structure
SELECT 
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'ai_settings'
ORDER BY ordinal_position;

-- Check data in ai_settings
SELECT * FROM public.ai_settings;
