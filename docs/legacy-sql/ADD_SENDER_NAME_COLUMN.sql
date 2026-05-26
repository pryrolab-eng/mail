-- Run this in Supabase SQL Editor
-- Adds sender_name column to smtp_accounts table

ALTER TABLE public.smtp_accounts
  ADD COLUMN IF NOT EXISTS sender_name TEXT;

-- Backfill existing accounts: derive display name from email
UPDATE public.smtp_accounts
SET sender_name = initcap(replace(replace(replace(split_part(email, '@', 1), '.', ' '), '_', ' '), '-', ' '))
WHERE sender_name IS NULL;
