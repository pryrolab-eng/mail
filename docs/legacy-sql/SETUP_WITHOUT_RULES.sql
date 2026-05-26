-- Setup Follow-Up System WITHOUT Automation Rules
-- Use this if you don't have a user account yet or want to skip automation rules for now

-- ============================================
-- STEP 1: Run the migration (creates tables)
-- ============================================
-- Copy and paste the entire contents of:
-- supabase/migrations/20240606_email_tracking_replies.sql
-- Then run it in Supabase SQL Editor

-- ============================================
-- STEP 2: Verify tables were created
-- ============================================
SELECT 
  table_name,
  CASE 
    WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE information_schema.tables.table_name = t.table_name) 
    THEN '✅ Created'
    ELSE '❌ Missing'
  END as status
FROM (
  VALUES 
    ('email_replies'),
    ('ai_replies'),
    ('email_inbox_config'),
    ('email_automation_rules'),
    ('crm_automation_log')
) AS t(table_name);

-- ============================================
-- STEP 3: Verify triggers were created
-- ============================================
SELECT 
  trigger_name,
  event_object_table,
  '✅ Active' as status
FROM information_schema.triggers
WHERE trigger_name IN (
  'trigger_auto_update_lead_on_reply',
  'trigger_update_sent_email_on_reply'
);

-- ============================================
-- STEP 4: Check for users (optional)
-- ============================================
SELECT 
  CASE 
    WHEN COUNT(*) = 0 THEN '⚠️  No users yet - Sign up at /sign-up first'
    ELSE '✅ Found ' || COUNT(*) || ' user(s)'
  END as user_status
FROM auth.users;

-- ============================================
-- SUCCESS!
-- ============================================
SELECT 
  '✅ Follow-Up System Setup Complete!' as status,
  'You can now use the Follow-Up module in your dashboard' as message,
  'Automation rules can be added later after you sign up' as note;

-- ============================================
-- NEXT STEPS:
-- ============================================
-- 1. Sign up at: http://localhost:3000/sign-up
-- 2. Go to Dashboard → Follow-Up module
-- 3. Test the "Check for Replies" button (demo mode)
-- 4. Later, run SETUP_AUTOMATION_RULES_SIMPLE.sql to add automation rules
