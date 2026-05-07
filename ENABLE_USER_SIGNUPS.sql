-- Enable user signups in Supabase
-- Run this in Supabase SQL Editor

-- Check current auth settings
SELECT * FROM auth.config;

-- If signups are disabled, you need to enable them in the Supabase Dashboard:
-- 1. Go to Authentication → Providers
-- 2. Enable "Email" provider
-- 3. Enable "Enable sign ups"

-- Verify that users can be created
SELECT 
  'Auth is configured. Check Dashboard: Authentication → Providers → Email → Enable sign ups' as message;

-- Optional: Check if there are any existing users
SELECT 
  id, 
  email, 
  created_at,
  last_sign_in_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 10;
