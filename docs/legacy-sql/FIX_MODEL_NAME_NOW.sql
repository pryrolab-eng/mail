-- Fix the invalid model name
-- Your current model: llama-3.1-70b-versatile (DECOMMISSIONED)
-- Correct model: llama-3.3-70b-versatile (CURRENT)

UPDATE ai_settings
SET active_model = 'llama-3.3-70b-versatile'
WHERE user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid
  AND provider = 'groq';

-- Verify the fix
SELECT 
  provider,
  active_model,
  is_active,
  LEFT(api_key, 10) || '...' as api_key_preview
FROM ai_settings
WHERE user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae'::uuid
  AND provider = 'groq';

-- You should see:
-- provider: groq
-- active_model: llama-3.3-70b-versatile
-- is_active: true

-- CURRENT GROQ MODELS (April 2026):
-- Production Models:
-- ✅ llama-3.3-70b-versatile (RECOMMENDED - 280 T/sec)
-- ✅ llama-3.1-8b-instant (560 T/sec, cheaper)
-- ✅ openai/gpt-oss-120b (500 T/sec)
-- ✅ openai/gpt-oss-20b (1000 T/sec, fastest)
-- ✅ groq/compound (AI system with tools)
