-- Check if ai_providers table exists

-- 1. Check in information_schema
SELECT 
  table_schema,
  table_name,
  '✅ Table exists' as status
FROM information_schema.tables
WHERE table_name = 'ai_providers';

-- 2. If no results above, the table doesn't exist. Create it:
CREATE TABLE IF NOT EXISTS public.ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'groq')),
  api_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- 3. Enable RLS
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS policies
DROP POLICY IF EXISTS "Users can view their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can view their own AI providers"
  ON public.ai_providers FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can insert their own AI providers"
  ON public.ai_providers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own AI providers" ON public.ai_providers;
CREATE POLICY "Users can update their own AI providers"
  ON public.ai_providers FOR UPDATE
  USING (auth.uid() = user_id);

-- 5. Verify table was created
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'ai_providers'
ORDER BY ordinal_position;
