-- MINIMAL SMTP SETUP - Run this in Supabase SQL Editor
-- This is a simplified version for debugging

-- Step 1: Create the table
CREATE TABLE IF NOT EXISTS public.smtp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  user_name VARCHAR(255) NOT NULL,
  password TEXT NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'Gmail',
  daily_limit INTEGER NOT NULL DEFAULT 500,
  sent_today INTEGER NOT NULL DEFAULT 0,
  last_reset TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, email)
);

-- Step 2: Create index
CREATE INDEX IF NOT EXISTS idx_smtp_accounts_user_id ON public.smtp_accounts(user_id);

-- Step 3: Enable RLS
ALTER TABLE public.smtp_accounts ENABLE ROW LEVEL SECURITY;

-- Step 4: Create policies (drop first if they exist)
DROP POLICY IF EXISTS "Users can view their own SMTP accounts" ON public.smtp_accounts;
DROP POLICY IF EXISTS "Users can insert their own SMTP accounts" ON public.smtp_accounts;
DROP POLICY IF EXISTS "Users can update their own SMTP accounts" ON public.smtp_accounts;
DROP POLICY IF EXISTS "Users can delete their own SMTP accounts" ON public.smtp_accounts;

CREATE POLICY "Users can view their own SMTP accounts"
  ON public.smtp_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own SMTP accounts"
  ON public.smtp_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own SMTP accounts"
  ON public.smtp_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own SMTP accounts"
  ON public.smtp_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- Step 5: Verify it worked
SELECT 'SUCCESS! smtp_accounts table created' as status;
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'smtp_accounts';
SELECT COUNT(*) as policy_count FROM pg_policies WHERE tablename = 'smtp_accounts';
