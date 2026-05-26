-- Add SMTP account for pryrolab@gmail.com
-- ⚠️ REPLACE 'YOUR_GMAIL_APP_PASSWORD' with your actual Gmail App Password

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
  '91416b57-9f98-4612-b88a-8ac157f31a73',
  'pryrolab@gmail.com',
  'smtp.gmail.com',
  587,
  'pryrolab@gmail.com',
  'YOUR_GMAIL_APP_PASSWORD',  -- ⚠️ REPLACE THIS with your 16-char app password
  'gmail',
  500,
  0,
  'active'
);

-- Verify it was added
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
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73';
