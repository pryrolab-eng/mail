-- Force refresh Supabase PostgREST schema cache
-- This is the most aggressive way to refresh the cache

-- Method 1: Send NOTIFY signal
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- Method 2: Touch the table to trigger cache update
ALTER TABLE smtp_accounts REPLICA IDENTITY DEFAULT;

-- Method 3: Grant explicit permissions (sometimes helps with cache)
GRANT ALL ON smtp_accounts TO authenticated;
GRANT ALL ON smtp_accounts TO anon;
GRANT ALL ON smtp_accounts TO service_role;

-- Method 4: Refresh materialized views if any
-- (Not applicable here, but good to know)

-- Verify the table is accessible
SELECT 
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE tablename = 'smtp_accounts';

-- Check current grants
SELECT 
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'smtp_accounts';

-- Test query
SELECT COUNT(*) as total_accounts FROM smtp_accounts;
