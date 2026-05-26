-- ⚠️ REPLACE YOUR GROQ API KEY BELOW, THEN RUN THIS
-- Get free API key: https://console.groq.com/keys (takes 30 seconds)

INSERT INTO public.ai_providers (
  user_id,
  provider,
  api_key,
  model_name,
  is_active
) VALUES (
  '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid,
  'groq',
  'PASTE_YOUR_GROQ_API_KEY_HERE',     -- ⚠️ Replace this with your actual Groq API key (starts with gsk_)
  'llama-3.3-70b-versatile',
  true
)
ON CONFLICT (user_id, provider) DO UPDATE
SET 
  api_key = EXCLUDED.api_key,
  model_name = EXCLUDED.model_name,
  is_active = true,
  updated_at = NOW();

-- Verify it worked:
SELECT 
  provider,
  model_name,
  is_active,
  '✅ AI Provider Active!' as status
FROM public.ai_providers
WHERE user_id = '91416b57-9f98-4612-b88a-8ac157f31a73'::uuid;
