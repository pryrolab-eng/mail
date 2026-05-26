-- Check if SMTP accounts exist and their status
SELECT 
  id,
  user_id,
  email,
  host,
  port,
  status,
  sent_today,
  daily_limit,
  last_reset,
  created_at
FROM public.smtp_accounts
ORDER BY created_at DESC;

-- Count total accounts by status
SELECT 
  status,
  COUNT(*) as count
FROM public.smtp_accounts
GROUP BY status;

-- Check if table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'smtp_accounts'
) as smtp_table_exists;
