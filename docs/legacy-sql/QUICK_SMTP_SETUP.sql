-- Quick SMTP Setup - Run this in Supabase SQL Editor
-- This creates the smtp_accounts table with all necessary permissions

-- Drop existing table if there are issues (CAREFUL: This deletes data!)
-- DROP TABLE IF EXISTS smtp_accounts CASCADE;

-- Create SMTP accounts table
CREATE TABLE IF NOT EXISTS smtp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  user_name VARCHAR(255) NOT NULL,
  password TEXT NOT NULL,
  provider VARCHAR(50) NOT NULL,
  daily_limit INTEGER NOT NULL DEFAULT 100,
  sent_today INTEGER NOT NULL DEFAULT 0,
  last_reset TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_smtp_accounts_user_id ON smtp_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_smtp_accounts_status ON smtp_accounts(status);

-- Enable RLS
ALTER TABLE smtp_accounts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own SMTP accounts" ON smtp_accounts;
DROP POLICY IF EXISTS "Users can insert their own SMTP accounts" ON smtp_accounts;
DROP POLICY IF EXISTS "Users can update their own SMTP accounts" ON smtp_accounts;
DROP POLICY IF EXISTS "Users can delete their own SMTP accounts" ON smtp_accounts;

-- Create policies
CREATE POLICY "Users can view their own SMTP accounts"
  ON smtp_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own SMTP accounts"
  ON smtp_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own SMTP accounts"
  ON smtp_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own SMTP accounts"
  ON smtp_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- Test the table
SELECT 'SMTP accounts table created successfully!' as message;

-- Show current user (for debugging)
SELECT auth.uid() as current_user_id;
