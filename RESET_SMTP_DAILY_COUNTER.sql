-- ============================================================
-- RESET SMTP DAILY COUNTERS + FIX STUCK ERROR STATUS
-- Run this NOW in Supabase SQL Editor
-- ============================================================

-- Add missing columns first (safe — IF NOT EXISTS)
ALTER TABLE public.smtp_accounts ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE public.smtp_accounts ADD COLUMN IF NOT EXISTS sender_name TEXT;

-- Reset ALL accounts: zero the counter, restore active status
UPDATE public.smtp_accounts
SET 
  sent_today = 0,
  last_reset = NOW(),
  status = 'active'
WHERE 
  status IN ('active', 'error');

-- Verify
SELECT 
  email,
  status,
  sent_today,
  daily_limit,
  last_reset::date AS reset_date,
  CURRENT_DATE AS today
FROM public.smtp_accounts
ORDER BY created_at DESC;
