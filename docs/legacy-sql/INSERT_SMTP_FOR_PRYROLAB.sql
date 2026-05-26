-- ============================================
-- ADD SMTP ACCOUNT FOR pryrolab@gmail.com
-- ============================================

-- Step 1: Replace YOUR_GMAIL_APP_PASSWORD below with your actual Gmail App Password
-- Step 2: Run this INSERT statement

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
  '91416b57-9f98-4612-b88a-8ac157f31a73',  -- Your user ID (already filled in!)
  'pryrolab@gmail.com',                     -- Your Gmail (already filled in!)
  'smtp.gmail.com',                         -- Gmail SMTP host
  587,                                      -- Port (587 for TLS)
  'pryrolab@gmail.com',                     -- Same as email
  'YOUR_GMAIL_APP_PASSWORD',                -- ⚠️ REPLACE THIS with your 16-char app password
  'gmail',                                  -- Provider
  500,                                      -- Daily limit (Gmail allows 500/day)
  0,                                        -- Sent today (starts at 0)
  'active'                                  -- Status
);

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
-- HOW TO GET GMAIL APP PASSWORD:
-- ============================================
-- 1. Go to: https://myaccount.google.com/security
-- 2. Enable 2-Step Verification (if not already enabled)
-- 3. Go to: https://myaccount.google.com/apppasswords
-- 4. Select "Mail" and your device
-- 5. Click "Generate"
-- 6. Copy the 16-character password (looks like: abcd efgh ijkl mnop)
-- 7. Replace YOUR_GMAIL_APP_PASSWORD above with it (remove spaces)
-- 8. Run the INSERT statement
-- ============================================
