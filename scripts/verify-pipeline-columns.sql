SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'leads'
  AND column_name IN ('pipeline_stage', 'pipeline_updated_at', 'pipeline_error')
ORDER BY column_name;
