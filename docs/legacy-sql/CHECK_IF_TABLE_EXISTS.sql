-- Check if smtp_accounts table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'smtp_accounts'
) as smtp_table_exists;

-- If the result is 'false', you need to run COMPLETE_SMTP_SETUP.sql first!
-- If the result is 'true', check if there are any accounts:

SELECT COUNT(*) as account_count FROM public.smtp_accounts;

-- Show all tables in public schema
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
