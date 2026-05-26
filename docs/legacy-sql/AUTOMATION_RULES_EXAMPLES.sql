-- Email Automation Rules Examples
-- Run these in Supabase SQL Editor to set up common automation workflows

-- Replace 'YOUR_USER_ID' with your actual user ID from auth.users

-- ============================================
-- RULE 1: Auto-reply to Interested Leads
-- ============================================
-- When a positive reply is received, automatically generate and send an AI response

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
  'YOUR_USER_ID',
  'Auto-reply to interested leads',
  'positive_reply',
  '{"min_confidence": 0.7, "keywords": ["interested", "tell me more", "schedule"]}'::jsonb,
  'send_ai_reply',
  '{"tone": "professional", "auto_send": false, "require_approval": true}'::jsonb,
  true,
  1
);

-- ============================================
-- RULE 2: Update CRM Status on Positive Reply
-- ============================================
-- When a positive reply is received, update lead status to "Interested"

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
  'YOUR_USER_ID',
  'Mark as Interested on positive reply',
  'positive_reply',
  '{}'::jsonb,
  'update_crm_status',
  '{"new_status": "Interested", "add_note": "Replied with positive sentiment"}'::jsonb,
  true,
  2
);

-- ============================================
-- RULE 3: Mark as Dead on Negative Reply
-- ============================================
-- When a negative reply is received, update lead status to "Dead"

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
  'YOUR_USER_ID',
  'Mark as Dead on rejection',
  'negative_reply',
  '{"keywords": ["not interested", "unsubscribe", "remove"]}'::jsonb,
  'update_crm_status',
  '{"new_status": "Dead", "add_note": "Explicitly not interested"}'::jsonb,
  true,
  1
);

-- ============================================
-- RULE 4: Follow-up After 3 Days No Reply
-- ============================================
-- If no reply after 3 days, send a follow-up email

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
  'YOUR_USER_ID',
  'Follow-up after 3 days',
  'no_reply_after_days',
  '{"days": 3, "max_followups": 2}'::jsonb,
  'send_ai_reply',
  '{"tone": "casual", "template": "follow_up_gentle", "auto_send": false}'::jsonb,
  true,
  3
);

-- ============================================
-- RULE 5: Follow-up After 7 Days No Reply
-- ============================================
-- If still no reply after 7 days, send a final follow-up

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
  'YOUR_USER_ID',
  'Final follow-up after 7 days',
  'no_reply_after_days',
  '{"days": 7, "max_followups": 1}'::jsonb,
  'send_ai_reply',
  '{"tone": "friendly", "template": "follow_up_final", "auto_send": false}'::jsonb,
  true,
  4
);

-- ============================================
-- RULE 6: Notify on Any Reply
-- ============================================
-- Send notification when any reply is received

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
  'YOUR_USER_ID',
  'Notify on any reply',
  'reply_received',
  '{}'::jsonb,
  'send_notification',
  '{"channels": ["email", "slack"], "message": "New reply received from {company_name}"}'::jsonb,
  true,
  5
);

-- ============================================
-- RULE 7: Create Task for High-Value Leads
-- ============================================
-- When a positive reply is received from a high-value lead, create a task

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
  'YOUR_USER_ID',
  'Create task for high-value positive replies',
  'positive_reply',
  '{"lead_tags": ["high-value", "enterprise"]}'::jsonb,
  'create_task',
  '{"task_type": "schedule_call", "priority": "high", "due_in_hours": 24}'::jsonb,
  true,
  1
);

-- ============================================
-- RULE 8: Auto-reply with Calendar Link
-- ============================================
-- When someone asks for a meeting, send calendar link

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
  'YOUR_USER_ID',
  'Send calendar link on meeting request',
  'positive_reply',
  '{"keywords": ["meeting", "call", "schedule", "available", "calendar"]}'::jsonb,
  'send_ai_reply',
  '{"tone": "professional", "include_calendar_link": true, "calendar_url": "https://calendly.com/your-link"}'::jsonb,
  true,
  1
);

-- ============================================
-- View All Your Rules
-- ============================================

SELECT 
  name,
  trigger_type,
  action_type,
  is_active,
  priority,
  created_at
FROM email_automation_rules
WHERE user_id = 'YOUR_USER_ID'
ORDER BY priority ASC, created_at DESC;

-- ============================================
-- Test Automation Log
-- ============================================
-- View recent automation actions

SELECT 
  l.executed_at,
  l.action_type,
  l.old_status,
  l.new_status,
  leads.company_name,
  r.name as rule_name
FROM crm_automation_log l
LEFT JOIN leads ON l.lead_id = leads.id
LEFT JOIN email_automation_rules r ON l.rule_id = r.id
WHERE l.user_id = 'YOUR_USER_ID'
ORDER BY l.executed_at DESC
LIMIT 20;

-- ============================================
-- Disable a Rule
-- ============================================
-- To disable a rule, update is_active to false

-- UPDATE email_automation_rules
-- SET is_active = false
-- WHERE name = 'Rule name here' AND user_id = 'YOUR_USER_ID';

-- ============================================
-- Delete a Rule
-- ============================================
-- To delete a rule completely

-- DELETE FROM email_automation_rules
-- WHERE name = 'Rule name here' AND user_id = 'YOUR_USER_ID';
