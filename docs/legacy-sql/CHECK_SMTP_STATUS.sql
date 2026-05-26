-- Check SMTP account status and recent failures
SELECT 
  email,
  status,
  sent_today,
  daily_limit,
  last_error,
  last_reset,
  created_at
FROM smtp_accounts
ORDER BY created_at DESC;

-- Check recent failed emails
SELECT 
  to_email,
  subject,
  status,
  bounce_reason,
  sent_at
FROM sent_emails
WHERE status = 'failed'
ORDER BY sent_at DESC
LIMIT 20;

-- Reset SMTP accounts to active (run this to fix)
UPDATE smtp_accounts
SET status = 'active',
    last_error = NULL
WHERE status = 'error';
