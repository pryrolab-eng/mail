-- Fix SMTP accounts RLS policies
-- Run this in Supabase SQL Editor

-- First, check if RLS is enabled
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename = 'smtp_accounts';

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view their own SMTP accounts" ON public.smtp_accounts;
DROP POLICY IF EXISTS "Users can insert their own SMTP accounts" ON public.smtp_accounts;
DROP POLICY IF EXISTS "Users can update their own SMTP accounts" ON public.smtp_accounts;
DROP POLICY IF EXISTS "Users can delete their own SMTP accounts" ON public.smtp_accounts;
DROP POLICY IF EXISTS "Users can manage their own SMTP accounts" ON public.smtp_accounts;

-- Enable RLS
ALTER TABLE public.smtp_accounts ENABLE ROW LEVEL SECURITY;

-- Create a single comprehensive policy
CREATE POLICY "Users can manage their own SMTP accounts"
  ON public.smtp_accounts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON public.smtp_accounts TO authenticated;
GRANT ALL ON public.smtp_accounts TO service_role;

-- Verify policies are created
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies 
WHERE tablename = 'smtp_accounts';

-- Test query (should return your SMTP accounts)
SELECT 
  id,
  email,
  provider,
  status,
  created_at
FROM public.smtp_accounts
WHERE user_id = auth.uid();
