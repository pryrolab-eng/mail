-- Automatic Automation Rules Setup
-- This script automatically gets your user ID and creates common automation rules
-- Run this in Supabase SQL Editor

-- First, let's see your user ID
SELECT 
  id as user_id,
  email,
  created_at
FROM auth.users
ORDER BY created_at DESC
LIMIT 5;

-- Copy your user_id from the results above, then run the rest of this script
-- OR use the DO block below which will automatically use the first user

-- ============================================
-- AUTOMATIC SETUP (uses first user in system)
-- ============================================

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Get the first user ID (or change this to get a specific user by email)
  SELECT id INTO v_user_id
  FROM auth.users
  ORDER BY created_at DESC
  LIMIT 1;

  -- Check if we found a user
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No user found in auth.users table';
  END IF;

  RAISE NOTICE 'Setting up automation rules for user: %', v_user_id;

  -- ============================================
  -- RULE 1: Auto-reply to Interested Leads
  -- ============================================
  INSERT INTO email_automation_rules (
    user_id,
    name,
    trigger_type,
    trigger_condition,
    action_type,
    action_config,
    is_active,
    priority
  ) VALUES (
    v_user_id,
    'Auto-reply to interested leads',
    'positive_reply',
    '{"min_confidence": 0.7, "keywords": ["interested", "tell me more", "schedule"]}'::jsonb,
    'send_ai_reply',
    '{"tone": "professional", "auto_send": false, "require_approval": true}'::jsonb,
    true,
    1
  ) ON CONFLICT DO NOTHING;

  -- ============================================
  -- RULE 2: Update CRM Status on Positive Reply
  -- ============================================
  INSERT INTO email_automation_rules (
    user_id,
    name,
    trigger_type,
    trigger_condition,
    action_type,
    action_config,
    is_active,
    priority
  ) VALUES (
    v_user_id,
    'Mark as Interested on positive reply',
    'positive_reply',
    '{}'::jsonb,
    'update_crm_status',
    '{"new_status": "Interested", "add_note": "Replied with positive sentiment"}'::jsonb,
    true,
    2
  ) ON CONFLICT DO NOTHING;

  -- ============================================
  -- RULE 3: Mark as Dead on Negative Reply
  -- ============================================
  INSERT INTO email_automation_rules (
    user_id,
    name,
    trigger_type,
    trigger_condition,
    action_type,
    action_config,
    is_active,
    priority
  ) VALUES (
    v_user_id,
    'Mark as Dead on rejection',
    'negative_reply',
    '{"keywords": ["not interested", "unsubscribe", "remove"]}'::jsonb,
    'update_crm_status',
    '{"new_status": "Dead", "add_note": "Explicitly not interested"}'::jsonb,
    true,
    1
  ) ON CONFLICT DO NOTHING;

  -- ============================================
  -- RULE 4: Follow-up After 3 Days No Reply
  -- ============================================
  INSERT INTO email_automation_rules (
    user_id,
    name,
    trigger_type,
    trigger_condition,
    action_type,
    action_config,
    is_active,
    priority
  ) VALUES (
    v_user_id,
    'Follow-up after 3 days',
    'no_reply_after_days',
    '{"days": 3, "max_followups": 2}'::jsonb,
    'send_ai_reply',
    '{"tone": "casual", "template": "follow_up_gentle", "auto_send": false}'::jsonb,
    true,
    3
  ) ON CONFLICT DO NOTHING;

  -- ============================================
  -- RULE 5: Follow-up After 7 Days No Reply
  -- ============================================
  INSERT INTO email_automation_rules (
    user_id,
    name,
    trigger_type,
    trigger_condition,
    action_type,
    action_config,
    is_active,
    priority
  ) VALUES (
    v_user_id,
    'Final follow-up after 7 days',
    'no_reply_after_days',
    '{"days": 7, "max_followups": 1}'::jsonb,
    'send_ai_reply',
    '{"tone": "friendly", "template": "follow_up_final", "auto_send": false}'::jsonb,
    true,
    4
  ) ON CONFLICT DO NOTHING;

  -- ============================================
  -- RULE 6: Notify on Any Reply
  -- ============================================
  INSERT INTO email_automation_rules (
    user_id,
    name,
    trigger_type,
    trigger_condition,
    action_type,
    action_config,
    is_active,
    priority
  ) VALUES (
    v_user_id,
    'Notify on any reply',
    'reply_received',
    '{}'::jsonb,
    'send_notification',
    '{"channels": ["email", "slack"], "message": "New reply received from {company_name}"}'::jsonb,
    true,
    5
  ) ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Successfully created automation rules!';
END $$;

-- ============================================
-- Verify Rules Were Created
-- ============================================
SELECT 
  name,
  trigger_type,
  action_type,
  is_active,
  priority,
  created_at
FROM email_automation_rules
ORDER BY priority ASC, created_at DESC;

-- ============================================
-- Success Message
-- ============================================
SELECT 
  'Setup Complete! ✅' as status,
  COUNT(*) as rules_created
FROM email_automation_rules;
