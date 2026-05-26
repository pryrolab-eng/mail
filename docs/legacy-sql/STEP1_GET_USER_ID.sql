-- STEP 1: Get Your User ID
-- Run this first in Supabase SQL Editor

SELECT 
  id as user_id,
  email,
  '👆 COPY THIS user_id - you need it for the next step' as instruction
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- After running this:
-- 1. Copy the user_id value (looks like: 12345678-1234-1234-1234-123456789abc)
-- 2. Go to https://console.groq.com/keys to get a free API key
-- 3. Then open STEP2_ADD_AI_PROVIDER.sql and fill in both values
