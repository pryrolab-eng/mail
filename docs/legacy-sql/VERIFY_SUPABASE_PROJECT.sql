-- Verify which Supabase project you're in

-- Show the project reference (part of the URL)
SELECT current_database() as database_name;

-- Show all users
SELECT 
  id,
  email,
  created_at,
  'User in THIS Supabase project' as note
FROM auth.users
ORDER BY created_at DESC;

-- The app shows user: eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae
-- But SQL shows user: 91416b57-9f98-4612-b88a-8ac157f31a73
-- These are DIFFERENT users, meaning DIFFERENT Supabase projects!

-- Check your .env.local file:
-- NEXT_PUBLIC_SUPABASE_URL should match the SQL Editor URL
