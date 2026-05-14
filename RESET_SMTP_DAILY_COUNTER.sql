-- ============================================================
-- RESET SMTP DAILY COUNTERS — Run this NOW in Supabase SQL Editor
-- ============================================================

-- Reset ALL accounts to 0 for today
UPDATE public.smtp_accounts
SET 
  sent_today = 0,
  last_reset = NOW()
WHERE 
  last_reset IS NULL 
  OR last_reset < date_trunc('day', NOW());

-- Verify
SELECT 
  email,
  sent_today,
  daily_limit,
  last_reset::date AS reset_date,
  CURRENT_DATE AS today,
  status
FROM public.smtp_accounts
ORDER BY created_at DESC;
