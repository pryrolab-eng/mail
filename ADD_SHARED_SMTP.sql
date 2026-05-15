-- ============================================================
-- ADD SHARED SMTP SUPPORT
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add is_shared column
ALTER TABLE public.smtp_accounts 
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT false;

-- Mark pryrolab as shared so all users can use it
UPDATE public.smtp_accounts 
SET is_shared = true 
WHERE email = 'pryrolab@gmail.com';

-- Update RLS policy to allow all authenticated users to READ shared accounts
DROP POLICY IF EXISTS "Users can view shared smtp accounts" ON public.smtp_accounts;
CREATE POLICY "Users can view shared smtp accounts"
  ON public.smtp_accounts FOR SELECT
  USING (
    auth.uid() = user_id   -- own accounts
    OR is_shared = true    -- OR shared accounts
  );

-- Verify
SELECT email, user_id, is_shared, status, sent_today, daily_limit 
FROM public.smtp_accounts;
