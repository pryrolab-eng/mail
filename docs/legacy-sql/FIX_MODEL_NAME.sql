-- Fix the model name in ai_settings
-- Current: llama-3-70b-8192 (doesn't exist)
-- Correct: llama-3.3-70b-versatile

UPDATE public.ai_settings
SET active_model = 'llama-3.3-70b-versatile'
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;

-- Verify
SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  '✅ Model name fixed!' as status
FROM public.ai_settings
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;
