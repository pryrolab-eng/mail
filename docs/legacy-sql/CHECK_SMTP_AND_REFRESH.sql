-- Check if smtp_accounts has any data
SELECT * FROM public.smtp_accounts;

-- Check the table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'smtp_accounts'
ORDER BY ordinal_position;

-- Refresh the schema cache by running a simple query
SELECT COUNT(*) FROM public.smtp_accounts;

-- Check RLS policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'smtp_accounts';
