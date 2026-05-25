-- Pipeline status tracking for leads (scrape → research → email → send)

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'scraped';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pipeline_updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pipeline_error TEXT;

-- Backfill existing rows
UPDATE public.leads
SET
  pipeline_stage = COALESCE(pipeline_stage, 'scraped'),
  pipeline_updated_at = COALESCE(pipeline_updated_at, now())
WHERE pipeline_stage IS NULL OR pipeline_updated_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_pipeline_stage_check'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_pipeline_stage_check
      CHECK (
        pipeline_stage IN (
          'scraped',
          'researched',
          'email_drafted',
          'sent',
          'replied',
          'failed'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_pipeline_stage ON public.leads(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_updated_at ON public.leads(pipeline_updated_at DESC);
