-- Add AI Settings for the user that ACTUALLY EXISTS in auth.users
-- User: 91416b57-9f98-4612-b88a-8ac157f31a73

INSERT INTO public.ai_settings (
  user_id,
  provider,
  api_key,
  active_model,
  is_active,
  is_connected
) VALUES (
  '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid,
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

-- Verify
SELECT 
  user_id,
  provider,
  active_model,
  is_active,
  '✅ Done!' as status
FROM public.ai_settings
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;
