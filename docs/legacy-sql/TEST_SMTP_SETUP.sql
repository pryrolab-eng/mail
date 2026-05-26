-- Test SMTP Setup Script
-- Run this in your Supabase SQL Editor to verify everything is set up correctly

-- 1. Check if smtp_accounts table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'smtp_accounts'
) as smtp_accounts_exists;

-- 2. Check table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'smtp_accounts'
ORDER BY ordinal_position;

-- 3. Check RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'smtp_accounts';

-- 4. Test if current user can insert (replace with your user_id)
-- First, get your user ID:
SELECT auth.uid() as current_user_id;

-- 5. Check if there are any existing SMTP accounts
SELECT id, email, provider, status, created_at
FROM smtp_accounts
WHERE user_id = auth.uid();

-- 6. Verify RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' 
AND tablename = 'smtp_accounts';
