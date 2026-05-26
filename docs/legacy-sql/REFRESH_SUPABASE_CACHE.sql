-- Refresh Supabase PostgREST schema cache
-- This tells Supabase API to reload the schema and recognize the smtp_accounts table

NOTIFY pgrst, 'reload schema';

-- Verify the accounts are accessible
SELECT 
  id,
  email,
  host,
  port,
  provider,
  status,
  daily_limit,
  sent_today
FROM public.smtp_accounts
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73';

-- Check if RLS policies are working
SELECT 
  tablename,
  policyname,
  permissive,
  cmd
FROM pg_policies
WHERE tablename = 'smtp_accounts';
