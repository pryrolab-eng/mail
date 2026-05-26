-- Simple fix to enable categories
-- Run this in Supabase SQL Editor

-- Add columns if missing
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Create update function
CREATE OR REPLACE FUNCTION update_lead_categories(lead_ids uuid[], new_category text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.leads
  SET category = new_category
  WHERE id = ANY(lead_ids)
    AND user_id = auth.uid();
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION update_lead_categories(uuid[], text) TO authenticated;

-- Verify
SELECT 'Setup complete! Leads will now save with categories.' as status;
