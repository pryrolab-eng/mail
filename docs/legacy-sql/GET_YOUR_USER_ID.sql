-- Get Your User ID
-- Run this first to find your user ID, then use it in other scripts

-- ============================================
-- METHOD 1: Get all users
-- ============================================
SELECT 
  id as user_id,
  email,
  created_at,
  'Copy this UUID ☝️' as note
FROM auth.users
ORDER BY created_at DESC;

-- ============================================
-- METHOD 2: Get user by email (replace with your email)
-- ============================================
-- SELECT 
--   id as user_id,
--   email,
--   created_at
-- FROM auth.users
-- WHERE email = 'your-email@example.com';

-- ============================================
-- INSTRUCTIONS:
-- ============================================
-- 1. Run this query
-- 2. Copy the 'user_id' value (it looks like: 12345678-1234-1234-1234-123456789abc)
-- 3. Use this UUID in place of 'YOUR_USER_ID' in other scripts
-- 
-- OR just run SETUP_AUTOMATION_RULES_AUTO.sql which does this automatically!
