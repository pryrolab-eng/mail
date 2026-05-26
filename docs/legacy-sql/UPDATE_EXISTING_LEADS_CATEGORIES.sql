-- Update existing leads with categories based on niche and location
-- This will add categories to all your existing 455 leads

-- First, check current state
SELECT 
  COUNT(*) as total_leads,
  COUNT(category) as leads_with_category,
  COUNT(*) - COUNT(category) as leads_without_category
FROM public.leads;

-- Update leads with categories based on niche and location
UPDATE public.leads
SET category = CASE
  -- If both niche and location exist, combine them
  WHEN niche IS NOT NULL AND niche != '' AND location IS NOT NULL AND location != ''
    THEN niche || ' - ' || location
  -- If only niche exists
  WHEN niche IS NOT NULL AND niche != ''
    THEN niche
  -- If only location exists
  WHEN location IS NOT NULL AND location != ''
    THEN location
  -- Default
  ELSE 'Uncategorized'
END
WHERE category IS NULL OR category = '';

-- Verify the update
SELECT 
  category,
  COUNT(*) as lead_count
FROM public.leads
GROUP BY category
ORDER BY lead_count DESC;

-- Show success message
SELECT 
  '✅ Categories updated for all leads!' as status,
  COUNT(DISTINCT category) as unique_categories,
  COUNT(*) as total_leads
FROM public.leads;
