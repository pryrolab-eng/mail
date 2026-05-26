-- Run this in Supabase SQL Editor to fix SMTP accounts table
-- This will create the table if it doesn't exist and fix any RLS issues

-- Drop the table if it exists (to start fresh)
DROP TABLE IF EXISTS public.smtp_accounts CASCADE;

-- Create SMTP accounts table
CREATE TABLE public.smtp_accounts (
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
  last_reset TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, email)
);

-- Create indexes for better performance
CREATE INDEX idx_smtp_accounts_user_id ON public.smtp_accounts(user_id);
CREATE INDEX idx_smtp_accounts_status ON public.smtp_accounts(status);

-- Enable Row Level Security
ALTER TABLE public.smtp_accounts ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (allow users to manage their own SMTP accounts)
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

-- Grant permissions
GRANT ALL ON public.smtp_accounts TO authenticated;
GRANT ALL ON public.smtp_accounts TO service_role;

-- Verify the table was created
SELECT 
  'SMTP accounts table created successfully!' as message,
  COUNT(*) as existing_accounts
FROM public.smtp_accounts;
