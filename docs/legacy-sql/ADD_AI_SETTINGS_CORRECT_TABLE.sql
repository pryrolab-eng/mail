-- Add AI Settings to the CORRECT table (ai_settings, not ai_providers)
-- For user: eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae

INSERT INTO public.ai_settings (
  user_id,
  provider,
  api_key,
  active_model,
  is_active,
  is_connected
) VALUES (
  'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid,
  'groq',
  'YOUR_GROQ_API_KEY_HERE',  -- ⚠️ REPLACE WITH YOUR ACTUAL GROQ API KEY
  'llama-3.3-70b-versatile',
  true,
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET 
  api_key = EXCLUDED.api_key,
  active_model = EXCLUDED.active_model,
  is_active = true,
  is_connected = true,
  updated_at = NOW();

-- Verify it worked
SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  is_connected,
  '✅ AI Settings Added!' as status
FROM public.ai_settings
WHERE user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid;
