-- Create RPC function to insert leads with category (bypasses schema cache)
-- Run this in Supabase SQL Editor

-- First, ensure columns exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'category'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN category TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'source'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN source TEXT DEFAULT 'manual';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'tags'
  ) THEN
    ALTER TABLE public.leads ADD COLUMN tags TEXT[];
  END IF;
END $$;

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS insert_leads_with_category(jsonb);

-- Create the RPC function
CREATE OR REPLACE FUNCTION insert_leads_with_category(leads_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  lead_record jsonb;
  inserted_ids jsonb := '[]'::jsonb;
  new_id uuid;
BEGIN
  -- Loop through each lead in the array
  FOR lead_record IN SELECT * FROM jsonb_array_elements(leads_data)
  LOOP
    -- Insert the lead
    INSERT INTO public.leads (
      user_id,
      company_name,
      email,
      niche,
      location,
      company_context,
      status,
      category,
      source,
      tags
    ) VALUES (
      (lead_record->>'user_id')::uuid,
      lead_record->>'company_name',
      lead_record->>'email',
      lead_record->>'niche',
      lead_record->>'location',
      lead_record->>'company_context',
      COALESCE(lead_record->>'status', 'New'),
      lead_record->>'category',
      COALESCE(lead_record->>'source', 'manual'),
      CASE 
        WHEN lead_record->'tags' IS NOT NULL 
        THEN ARRAY(SELECT jsonb_array_elements_text(lead_record->'tags'))
        ELSE NULL 
      END
    )
    RETURNING id INTO new_id;
    
    -- Add the ID to our result array
    inserted_ids := inserted_ids || jsonb_build_object('id', new_id);
  END LOOP;
  
  RETURN inserted_ids;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION insert_leads_with_category(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION insert_leads_with_category(jsonb) TO anon;

-- Test the function
DO $$
DECLARE
  test_user_id uuid;
  result jsonb;
BEGIN
  -- Get a test user
  SELECT id INTO test_user_id FROM auth.users LIMIT 1;
  
  IF test_user_id IS NULL THEN
    RAISE NOTICE '⚠️  No users found - sign up first';
    RETURN;
  END IF;
  
  -- Test insert
  SELECT insert_leads_with_category(
    jsonb_build_array(
      jsonb_build_object(
        'user_id', test_user_id::text,
        'company_name', 'Test Company RPC',
        'email', 'test_rpc_' || extract(epoch from now()) || '@example.com',
        'niche', 'Test',
        'location', 'Test Location',
        'company_context', 'Test context',
        'status', 'New',
        'category', 'Test Category',
        'source', 'scraper',
        'tags', jsonb_build_array('test', 'rpc')
      )
    )
  ) INTO result;
  
  RAISE NOTICE '✅ Function test successful! Result: %', result;
  
  -- Clean up test data
  DELETE FROM public.leads WHERE company_name = 'Test Company RPC';
  RAISE NOTICE '✅ Test data cleaned up';
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '❌ Test failed: %', SQLERRM;
END $$;

SELECT '✅ RPC function created successfully!' as status;
SELECT '🔄 Now restart your dev server and try adding leads again' as next_step;
