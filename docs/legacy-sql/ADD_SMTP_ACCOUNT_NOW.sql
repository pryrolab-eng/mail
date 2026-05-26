-- ============================================
-- ADD YOUR SMTP ACCOUNT
-- Run this AFTER creating the table
-- ============================================

-- Step 1: Get your CORRECT user ID
-- IMPORTANT: Copy the 'id' value from the result below
SELECT 
  id,
  email,
  created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- Step 2: Replace the user_id below with YOUR ACTUAL USER ID from Step 1
-- Then replace the email and password details
-- Then run the INSERT statement

-- For Gmail:
-- REPLACE 'YOUR-USER-ID-HERE' with the actual ID from Step 1 above!
INSERT INTO public.smtp_accounts (
  user_id,
  email,
  host,
  port,
  user_name,
  password,
  provider,
  daily_limit,
  sent_today,
  status
) VALUES (
  'YOUR-USER-ID-HERE',                     -- ⚠️ REPLACE THIS with your actual user ID from Step 1!
  'your-email@gmail.com',                  -- Your Gmail address
  'smtp.gmail.com',                        -- Gmail SMTP host
  587,                                     -- Port (587 for TLS)
  'your-email@gmail.com',                  -- Same as email
  'your-app-password-here',                -- Gmail App Password (NOT regular password)
  'gmail',                                 -- Provider
  500,                                     -- Daily limit (Gmail allows 500/day)
  0,                                       -- Sent today (starts at 0)
  'active'                                 -- Status
);

-- For Outlook/Hotmail:
-- REPLACE 'YOUR-USER-ID-HERE' with the actual ID from Step 1 above!
-- INSERT INTO public.smtp_accounts (
--   user_id,
--   email,
--   host,
--   port,
--   user_name,
--   password,
--   provider,
--   daily_limit,
--   sent_today,
--   status
-- ) VALUES (
--   'YOUR-USER-ID-HERE',                   -- ⚠️ REPLACE THIS!
--   'your-email@outlook.com',
--   'smtp-mail.outlook.com',
--   587,
--   'your-email@outlook.com',
--   'your-password',
--   'outlook',
--   300,
--   0,
--   'active'
-- );

-- Step 3: Verify the account was added
SELECT 
  id,
  email,
  host,
  port,
  provider,
  status,
  daily_limit,
  sent_today,
  created_at
FROM public.smtp_accounts
ORDER BY created_at DESC;

-- ============================================
-- IMPORTANT: Gmail App Password Setup
-- ============================================
-- If using Gmail, you MUST use an App Password:
-- 1. Go to https://myaccount.google.com/security
-- 2. Enable 2-Step Verification (if not already enabled)
-- 3. Go to https://myaccount.google.com/apppasswords
-- 4. Create a new app password for "Mail"
-- 5. Copy the 16-character password (no spaces)
-- 6. Use that password in the INSERT statement above
-- 
-- DO NOT use your regular Gmail password - it won't work!
-- ============================================
