-- Add category column to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS tags TEXT[];
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';

-- Create index for faster category filtering
CREATE INDEX IF NOT EXISTS idx_leads_category ON public.leads(category);
CREATE INDEX IF NOT EXISTS idx_leads_source ON public.leads(source);

-- Create categories table for managing categories
CREATE TABLE IF NOT EXISTS public.lead_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(20) DEFAULT '#3B82F6',
  description TEXT,
  lead_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_lead_categories_user_id ON public.lead_categories(user_id);

-- Enable RLS
ALTER TABLE public.lead_categories ENABLE ROW LEVEL SECURITY;

-- Create policies (idempotent)
DROP POLICY IF EXISTS "Users can view their own categories" ON public.lead_categories;
CREATE POLICY "Users can view their own categories"
  ON public.lead_categories FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own categories" ON public.lead_categories;
CREATE POLICY "Users can insert their own categories"
  ON public.lead_categories FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own categories" ON public.lead_categories;
CREATE POLICY "Users can update their own categories"
  ON public.lead_categories FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own categories" ON public.lead_categories;
CREATE POLICY "Users can delete their own categories"
  ON public.lead_categories FOR DELETE USING (auth.uid() = user_id);

-- Function to auto-create category when leads are added
CREATE OR REPLACE FUNCTION auto_create_category()
RETURNS TRIGGER AS $$
BEGIN
  -- If category is set and doesn't exist, create it
  IF NEW.category IS NOT NULL THEN
    INSERT INTO public.lead_categories (user_id, name, description)
    VALUES (NEW.user_id, NEW.category, 'Auto-created from scraping')
    ON CONFLICT (user_id, name) DO NOTHING;
    
    -- Update lead count
    UPDATE public.lead_categories
    SET lead_count = (
      SELECT COUNT(*) FROM public.leads 
      WHERE user_id = NEW.user_id AND category = NEW.category
    )
    WHERE user_id = NEW.user_id AND name = NEW.category;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_auto_create_category ON public.leads;
CREATE TRIGGER trigger_auto_create_category
  AFTER INSERT OR UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_category();
