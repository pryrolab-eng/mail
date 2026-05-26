-- Quick Setup: Email Reply Tracking & AI Response System
-- Run this in your Supabase SQL Editor

-- STEP 1: Copy and paste the contents of supabase/migrations/20240606_email_tracking_replies.sql
-- OR run it directly if your Supabase CLI is set up

-- STEP 2: Verify tables were created
SELECT 
  'email_replies' as table_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'email_replies') as exists
UNION ALL
SELECT 
  'ai_replies' as table_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_replies') as exists
UNION ALL
SELECT 
  'email_inbox_config' as table_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'email_inbox_config') as exists
UNION ALL
SELECT 
  'email_automation_rules' as table_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'email_automation_rules') as exists
UNION ALL
SELECT 
  'crm_automation_log' as table_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_automation_log') as exists;

-- STEP 3: Verify triggers were created
SELECT 
  trigger_name,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name IN ('trigger_auto_update_lead_on_reply', 'trigger_update_sent_email_on_reply');

-- STEP 4: Next steps
SELECT 'Setup complete! ✅' as status,
       'Now run SETUP_AUTOMATION_RULES_AUTO.sql to create automation rules' as next_step;
