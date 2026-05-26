-- Quick fix for Groq model error
-- The old model name 'llama-3-70b-8192' no longer exists
-- Update to the new model name 'llama-3.3-70b-versatile'

UPDATE public.ai_settings
SET active_model = 'llama-3.3-70b-versatile'
WHERE provider = 'groq' 
  AND active_model = 'llama-3-70b-8192';

-- Verify the fix
SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  CASE 
    WHEN active_model = 'llama-3.3-70b-versatile' THEN '✅ FIXED'
    ELSE '❌ Still needs fixing'
  END as status
FROM public.ai_settings
WHERE provider = 'groq';
