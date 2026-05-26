-- Quick SMTP Account Setup
-- Run this in Supabase SQL Editor to add a test SMTP account

-- First, check if smtp_accounts table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name = 'smtp_accounts'
) as table_exists;

-- If table doesn't exist, create it
CREATE TABLE IF NOT EXISTS public.smtp_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  smtp_host VARCHAR(255) NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_user VARCHAR(255) NOT NULL,
  smtp_password TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  daily_limit INTEGER DEFAULT 50,
  emails_sent_today INTEGER DEFAULT 0,
  last_reset_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, email)
);

-- Enable RLS
ALTER TABLE public.smtp_accounts ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS "Users can view their own SMTP accounts" ON public.smtp_accounts;
CREATE POLICY "Users can view their own SMTP accounts"
  ON public.smtp_accounts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own SMTP accounts" ON public.smtp_accounts;
CREATE POLICY "Users can insert their own SMTP accounts"
  ON public.smtp_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own SMTP accounts" ON public.smtp_accounts;
CREATE POLICY "Users can update their own SMTP accounts"
  ON public.smtp_accounts FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own SMTP accounts" ON public.smtp_accounts;
CREATE POLICY "Users can delete their own SMTP accounts"
  ON public.smtp_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- Add a test SMTP account (Gmail example)
-- IMPORTANT: Replace with your actual email and app password
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get your user ID
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at DESC LIMIT 1;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found. Please sign up first.';
  END IF;
  
  -- Insert test SMTP account
  -- For Gmail: Use App Password (not your regular password)
  -- Generate at: https://myaccount.google.com/apppasswords
  INSERT INTO public.smtp_accounts (
    user_id,
    email,
    smtp_host,
    smtp_port,
    smtp_user,
    smtp_password,
    is_active,
    daily_limit
  ) VALUES (
    v_user_id,
    'your-email@gmail.com',  -- CHANGE THIS
    'smtp.gmail.com',
    587,
    'your-email@gmail.com',  -- CHANGE THIS
    'your-app-password-here', -- CHANGE THIS (16-character app password)
    true,
    50
  )
  ON CONFLICT (user_id, email) DO UPDATE
  SET 
    smtp_password = EXCLUDED.smtp_password,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
  
  RAISE NOTICE '✅ SMTP account added for user: %', v_user_id;
  RAISE NOTICE '⚠️  IMPORTANT: Update the email and app password above!';
END $$;

-- Verify the account was added
SELECT 
  email,
  smtp_host,
  smtp_port,
  is_active,
  daily_limit,
  '✅ Account configured' as status
FROM public.smtp_accounts
ORDER BY created_at DESC
LIMIT 5;

-- Instructions
SELECT '
📧 SMTP SETUP COMPLETE!

Next steps:
1. Go to SMTP Manager in the app
2. Click "Add SMTP Account"
3. Enter your Gmail details:
   - Email: your-email@gmail.com
   - SMTP Host: smtp.gmail.com
   - SMTP Port: 587
   - Username: your-email@gmail.com
   - Password: Your 16-character App Password

To get Gmail App Password:
1. Go to https://myaccount.google.com/apppasswords
2. Create a new app password
3. Copy the 16-character code
4. Use it as your SMTP password

OR run this script with your actual credentials!
' as instructions;
