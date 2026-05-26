-- Simple SMTP Account Setup
-- Step 1: Run this to get your user ID

SELECT 
  id as user_id,
  email,
  '👆 Copy this user_id for next step' as instruction
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- Step 2: Get your Gmail App Password
-- Go to: https://myaccount.google.com/apppasswords
-- Create a new app password and copy the 16-character code

-- Step 3: Create SMTP table if needed
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

ALTER TABLE public.smtp_accounts ENABLE ROW LEVEL SECURITY;

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

-- Step 4: Add your SMTP account
-- Replace the values below with your actual information

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
  'YOUR_USER_ID_HERE'::uuid,           -- Replace with your user_id from Step 1
  'your-email@gmail.com',              -- Your Gmail address
  'smtp.gmail.com',                    -- Gmail SMTP server
  587,                                 -- Port
  'your-email@gmail.com',              -- Same as email
  'your-16-char-app-password',         -- Your Gmail App Password (no spaces)
  true,                                -- Active
  50                                   -- Daily limit
)
ON CONFLICT (user_id, email) DO UPDATE
SET 
  smtp_password = EXCLUDED.smtp_password,
  is_active = true,
  updated_at = NOW();

-- Step 5: Verify it worked
SELECT 
  email,
  smtp_host,
  smtp_port,
  is_active,
  daily_limit,
  '✅ SMTP account configured' as status
FROM public.smtp_accounts
ORDER BY created_at DESC;

-- Instructions
SELECT '
📧 GMAIL APP PASSWORD SETUP:

1. Go to: https://myaccount.google.com/apppasswords
2. Sign in to your Google account
3. Click "Create" or "Generate app password"
4. Name it "Pryro CRM" or similar
5. Copy the 16-character password (remove spaces)
6. Paste it in the smtp_password field above
7. Run this script again

Example app password format: abcdabcdabcdabcd (16 chars, no spaces)

⚠️  IMPORTANT: 
- Use App Password, NOT your regular Gmail password
- Enable 2-Step Verification first if not already enabled
- The app password is 16 characters with no spaces
' as instructions;
