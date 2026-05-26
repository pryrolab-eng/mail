-- Simple Automation Rules Setup
-- This version will guide you through the process

-- ============================================
-- STEP 1: Check if you have any users
-- ============================================
SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN '❌ No users found! Please sign up first at /sign-up'
    ELSE '✅ Found ' || COUNT(*) || ' user(s)'
  END as status,
  COUNT(*) as user_count
FROM auth.users;

-- ============================================
-- STEP 2: View your users (if any exist)
-- ============================================
SELECT 
  id as user_id,
  email,
  created_at,
  '👆 Copy this user_id to use below' as note
FROM auth.users
ORDER BY created_at DESC;

-- ============================================
-- STEP 3: If you see users above, continue here
-- Replace 'PASTE_YOUR_USER_ID_HERE' with the actual UUID from above
-- ============================================

-- Uncomment and run the block below AFTER you have a user ID:

/*
DO $$
DECLARE
  v_user_id UUID := 'PASTE_YOUR_USER_ID_HERE'; -- Replace this!
BEGIN
  -- Verify the user exists
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'User ID % not found. Please check the ID and try again.', v_user_id;
  END IF;

  RAISE NOTICE 'Creating automation rules for user: %', v_user_id;

  -- Rule 1: Mark as Interested on positive reply
  INSERT INTO email_automation_rules (
    user_id, name, trigger_type, action_type, action_config, is_active, priority
  ) VALUES (
    v_user_id,
    'Mark as Interested on positive reply',
    'positive_reply',
    'update_crm_status',
    '{"new_status": "Interested", "add_note": "Replied with positive sentiment"}'::jsonb,
    true, 2
  ) ON CONFLICT DO NOTHING;

  -- Rule 2: Mark as Dead on negative reply
  INSERT INTO email_automation_rules (
    user_id, name, trigger_type, action_type, action_config, is_active, priority
  ) VALUES (
    v_user_id,
    'Mark as Dead on rejection',
    'negative_reply',
    'update_crm_status',
    '{"new_status": "Dead", "add_note": "Explicitly not interested"}'::jsonb,
    true, 1
  ) ON CONFLICT DO NOTHING;

  -- Rule 3: Auto-reply to interested leads
  INSERT INTO email_automation_rules (
    user_id, name, trigger_type, action_type, action_config, is_active, priority
  ) VALUES (
    v_user_id,
    'Auto-reply to interested leads',
    'positive_reply',
    'send_ai_reply',
    '{"tone": "professional", "auto_send": false, "require_approval": true}'::jsonb,
    true, 1
  ) ON CONFLICT DO NOTHING;

  -- Rule 4: Follow-up after 3 days
  INSERT INTO email_automation_rules (
    user_id, name, trigger_type, action_type, action_config, is_active, priority
  ) VALUES (
    v_user_id,
    'Follow-up after 3 days',
    'no_reply_after_days',
    'send_ai_reply',
    '{"days": 3, "max_followups": 2, "tone": "casual", "auto_send": false}'::jsonb,
    true, 3
  ) ON CONFLICT DO NOTHING;

  -- Rule 5: Final follow-up after 7 days
  INSERT INTO email_automation_rules (
    user_id, name, trigger_type, action_type, action_config, is_active, priority
  ) VALUES (
    v_user_id,
    'Final follow-up after 7 days',
    'no_reply_after_days',
    'send_ai_reply',
    '{"days": 7, "max_followups": 1, "tone": "friendly", "auto_send": false}'::jsonb,
    true, 4
  ) ON CONFLICT DO NOTHING;

  -- Rule 6: Notify on any reply
  INSERT INTO email_automation_rules (
    user_id, name, trigger_type, action_type, action_config, is_active, priority
  ) VALUES (
    v_user_id,
    'Notify on any reply',
    'reply_received',
    'send_notification',
    '{"channels": ["email"], "message": "New reply received from {company_name}"}'::jsonb,
    true, 5
  ) ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Successfully created automation rules!';
END $$;
*/

-- ============================================
-- STEP 4: Verify rules were created
-- ============================================
-- Uncomment and run after creating rules:

/*
SELECT 
  name,
  trigger_type,
  action_type,
  is_active,
  priority,
  created_at
FROM email_automation_rules
ORDER BY priority ASC, created_at DESC;
*/

-- ============================================
-- INSTRUCTIONS:
-- ============================================
-- 1. First, sign up at your app: http://localhost:3000/sign-up
-- 2. Run STEP 1 and STEP 2 above to see your user ID
-- 3. Copy your user_id (the UUID)
-- 4. Uncomment STEP 3 block (remove /* and */)
-- 5. Replace 'PASTE_YOUR_USER_ID_HERE' with your actual UUID
-- 6. Run STEP 3
-- 7. Uncomment and run STEP 4 to verify
