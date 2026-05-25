-- Phone-only scrape lane + email confidence for generation filtering

-- call_list rows have no email yet
ALTER TABLE public.leads
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS email_source TEXT;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS email_confidence TEXT;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_pipeline_stage_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_pipeline_stage_check
  CHECK (
    pipeline_stage IN (
      'scraped',
      'call_list',
      'researched',
      'email_drafted',
      'sent',
      'replied',
      'failed'
    )
  );

COMMENT ON COLUMN public.leads.email_source IS 'maps_csv | website_mailto | website_visible | bing | domain_guess | manual';
COMMENT ON COLUMN public.leads.email_confidence IS 'high | medium | low — used before bulk email generation';
COMMENT ON COLUMN public.leads.pipeline_stage IS 'call_list = scraped from Maps with phone but no email yet';
