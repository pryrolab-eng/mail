-- Update by the exact ID from the logs
UPDATE public.ai_settings
SET 
  active_model = 'llama-3.3-70b-versatile',
  updated_at = NOW()
WHERE id = '2046bd53-febf-44a1-9394-9b105d137b3d'::uuid;

-- Verify
SELECT 
  id,
  user_id,
  provider,
  active_model,
  updated_at,
  '✅ Updated!' as status
FROM public.ai_settings
WHERE id = '2046bd53-febf-44a1-9394-9b105d137b3d'::uuid;
