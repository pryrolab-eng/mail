-- Clear old leads from the database
-- Run this in your Supabase SQL Editor to remove old scraped data
-- This will allow you to test the improved scraper with fresh data

-- Option 1: Delete ALL leads (use if you want to start fresh)
DELETE FROM leads;

-- Option 2: Delete only leads with fake emails (keeps real ones)
-- DELETE FROM leads WHERE email LIKE 'info@%school.com' OR email LIKE 'info@%schools.com';

-- Option 3: Delete leads from a specific niche/location
-- DELETE FROM leads WHERE niche = 'schools' AND location LIKE '%Rwanda%';

-- After running this, go back to your app and scrape again
-- The new scrape will use the improved email extraction logic
