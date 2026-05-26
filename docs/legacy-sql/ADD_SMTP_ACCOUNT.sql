-- Add SMTP Account (Correct Column Names)
-- Step 1: Get your user ID

SELECT 
  id as user_id,
  email,
  '👆 Copy this user_id for next step' as instruction
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- Step 2: Get Gmail App Password
-- Go to: https://myaccount.google.com/apppasswords
-- Create app password and copy the 16-character code

-- Step 3: Add your SMTP account
-- Replace the values below

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
  'YOUR_USER_ID_HERE'::uuid,           -- Replace with your user_id from Step 1
  'your-email@gmail.com',              -- Your Gmail address
  'smtp.gmail.com',                    -- Gmail SMTP host
  587,                                 -- Port
  'your-email@gmail.com',              -- Same as email
  'your-16-char-app-password',         -- Gmail App Password (no spaces)
  'gmail',                             -- Provider
  50,                                  -- Daily limit
  0,                                   -- Sent today (starts at 0)
  'active'                             -- Status
)
ON CONFLICT (user_id, email) DO UPDATE
SET 
  password = EXCLUDED.password,
  status = 'active',
  updated_at = NOW();

-- Step 4: Verify it worked
SELECT 
  email,
  host,
  port,
  provider,
  daily_limit,
  status,
  '✅ SMTP configured' as result
FROM public.smtp_accounts
ORDER BY created_at DESC;

-- Instructions
SELECT '
📧 SETUP COMPLETE!

To get Gmail App Password:
1. Visit: https://myaccount.google.com/apppasswords
2. Sign in to Google
3. Click "Create" or "Generate"
4. Name it "Pryro CRM"
5. Copy the 16-character code (remove spaces)
6. Paste above and run again

Example: abcdabcdabcdabcd (16 chars, no spaces)
' as instructions;
