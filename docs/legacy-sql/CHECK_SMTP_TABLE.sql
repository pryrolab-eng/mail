-- Check SMTP table structure
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'smtp_accounts'
ORDER BY ordinal_position;

-- Show existing SMTP accounts
SELECT * FROM public.smtp_accounts LIMIT 5;
