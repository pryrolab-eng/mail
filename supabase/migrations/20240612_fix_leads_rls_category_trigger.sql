-- Fix CRM insert: ensure RLS policies exist and category trigger does not block inserts

DROP POLICY IF EXISTS "Users can insert their own leads" ON public.leads;
CREATE POLICY "Users can insert their own leads"
  ON public.leads FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own leads" ON public.leads;
CREATE POLICY "Users can view their own leads"
  ON public.leads FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own leads" ON public.leads;
CREATE POLICY "Users can update their own leads"
  ON public.leads FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own leads" ON public.leads;
CREATE POLICY "Users can delete their own leads"
  ON public.leads FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Category auto-create runs as definer so it cannot fail RLS on lead_categories
CREATE OR REPLACE FUNCTION public.auto_create_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category IS NOT NULL THEN
    INSERT INTO public.lead_categories (user_id, name, description)
    VALUES (NEW.user_id, NEW.category, 'Auto-created from scraping')
    ON CONFLICT (user_id, name) DO NOTHING;

    UPDATE public.lead_categories
    SET lead_count = (
      SELECT COUNT(*)::INTEGER FROM public.leads
      WHERE user_id = NEW.user_id AND category = NEW.category
    )
    WHERE user_id = NEW.user_id AND name = NEW.category;
  END IF;
  RETURN NEW;
END;
$$;
