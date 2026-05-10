-- ============================================================================
-- SYSTEM HEALTH CHECK - Verify All Features Are Working
-- Run this in Supabase SQL Editor to check system status
-- ============================================================================

-- ══════════════════════════════════════════════════════════════════════════
-- 1. CHECK ALL TABLES EXIST
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  'leads' as table_name,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') as exists
UNION ALL
SELECT 'sent_emails', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'sent_emails')
UNION ALL
SELECT 'email_replies', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'email_replies')
UNION ALL
SELECT 'smtp_accounts', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'smtp_accounts')
UNION ALL
SELECT 'ai_settings', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_settings')
UNION ALL
SELECT 'notifications', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications')
UNION ALL
SELECT 'followup_queue', EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'followup_queue');

-- ══════════════════════════════════════════════════════════════════════════
-- 2. CHECK LEADS TABLE HAS ALL REQUIRED COLUMNS
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  'confidence_score' as column_name,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'confidence_score') as exists
UNION ALL
SELECT 'source', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'source')
UNION ALL
SELECT 'email_verified', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'email_verified')
UNION ALL
SELECT 'tags', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'tags')
UNION ALL
SELECT 'last_contacted_at', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'last_contacted_at')
UNION ALL
SELECT 'phone', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'phone')
UNION ALL
SELECT 'website', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'website');

-- ══════════════════════════════════════════════════════════════════════════
-- 3. CHECK SENT_EMAILS TABLE HAS TRACKING COLUMNS
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  'bounce_reason' as column_name,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'sent_emails' AND column_name = 'bounce_reason') as exists
UNION ALL
SELECT 'tracking_pixel_id', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'sent_emails' AND column_name = 'tracking_pixel_id')
UNION ALL
SELECT 'opened_at', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'sent_emails' AND column_name = 'opened_at')
UNION ALL
SELECT 'clicked_at', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'sent_emails' AND column_name = 'clicked_at')
UNION ALL
SELECT 'replied_at', EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'sent_emails' AND column_name = 'replied_at');

-- ══════════════════════════════════════════════════════════════════════════
-- 4. CHECK RLS (ROW LEVEL SECURITY) IS ENABLED
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('leads', 'sent_emails', 'smtp_accounts', 'email_replies', 'notifications')
ORDER BY tablename;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. CHECK RLS POLICIES EXIST
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  tablename,
  policyname,
  cmd as operation
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('leads', 'sent_emails', 'smtp_accounts')
ORDER BY tablename, cmd;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. DATA QUALITY CHECK - LEADS
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  COUNT(*) as total_leads,
  COUNT(DISTINCT user_id) as total_users,
  COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as leads_with_email,
  COUNT(CASE WHEN email_verified = true THEN 1 END) as verified_emails,
  COUNT(CASE WHEN confidence_score > 0 THEN 1 END) as leads_with_confidence,
  COUNT(CASE WHEN website IS NOT NULL THEN 1 END) as leads_with_website,
  COUNT(CASE WHEN phone IS NOT NULL THEN 1 END) as leads_with_phone,
  ROUND(AVG(confidence_score), 2) as avg_confidence_score
FROM leads;

-- ══════════════════════════════════════════════════════════════════════════
-- 7. EMAIL DELIVERY STATS
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM sent_emails
GROUP BY status
ORDER BY count DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- 8. SMTP ACCOUNTS STATUS
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  COUNT(*) as total_accounts,
  SUM(daily_limit) as total_daily_capacity,
  SUM(sent_today) as total_sent_today,
  SUM(daily_limit) - SUM(sent_today) as remaining_capacity,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_accounts,
  COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_accounts
FROM smtp_accounts;

-- ══════════════════════════════════════════════════════════════════════════
-- 9. RECENT ACTIVITY (LAST 24 HOURS)
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  'Leads Created' as activity,
  COUNT(*) as count
FROM leads
WHERE created_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 'Emails Sent', COUNT(*)
FROM sent_emails
WHERE sent_at > NOW() - INTERVAL '24 hours'
UNION ALL
SELECT 'Emails Failed', COUNT(*)
FROM sent_emails
WHERE sent_at > NOW() - INTERVAL '24 hours' AND status = 'failed'
UNION ALL
SELECT 'Replies Received', COUNT(*)
FROM email_replies
WHERE received_at > NOW() - INTERVAL '24 hours';

-- ══════════════════════════════════════════════════════════════════════════
-- 10. NOTIFICATIONS CHECK
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  type,
  COUNT(*) as count,
  COUNT(CASE WHEN is_read = false THEN 1 END) as unread
FROM notifications
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY type
ORDER BY count DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- 11. EMAIL QUALITY ANALYSIS
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  CASE 
    WHEN email LIKE 'info@%' THEN 'Generic (info@)'
    WHEN email LIKE 'contact@%' THEN 'Generic (contact@)'
    WHEN email LIKE 'hello@%' THEN 'Generic (hello@)'
    WHEN email LIKE 'admissions@%' THEN 'Generic (admissions@)'
    WHEN email_verified = true THEN 'Verified Real'
    ELSE 'Other'
  END as email_type,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM leads
WHERE email IS NOT NULL
GROUP BY email_type
ORDER BY count DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- 12. BOUNCE RATE ANALYSIS
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  CASE 
    WHEN status IN ('failed', 'bounced') THEN 'Bounced/Failed'
    WHEN status = 'sent' THEN 'Delivered'
    WHEN status = 'opened' THEN 'Opened'
    WHEN status = 'replied' THEN 'Replied'
    ELSE 'Other'
  END as delivery_status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM sent_emails
GROUP BY delivery_status
ORDER BY count DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- 13. SYSTEM HEALTH SUMMARY
-- ══════════════════════════════════════════════════════════════════════════
SELECT 
  '✅ System Health Check Complete' as status,
  NOW() as checked_at,
  (SELECT COUNT(*) FROM leads) as total_leads,
  (SELECT COUNT(*) FROM sent_emails) as total_emails_sent,
  (SELECT COUNT(*) FROM smtp_accounts WHERE status = 'active') as active_smtp_accounts,
  (SELECT SUM(daily_limit) - SUM(sent_today) FROM smtp_accounts) as remaining_email_capacity;

-- ══════════════════════════════════════════════════════════════════════════
-- INTERPRETATION GUIDE
-- ══════════════════════════════════════════════════════════════════════════
/*
✅ HEALTHY SYSTEM:
- All tables exist = true
- All required columns exist = true
- RLS enabled on all tables = true
- At least 1 active SMTP account
- Remaining capacity > 0
- Bounce rate < 10%
- Verified emails > 50%

⚠️ NEEDS ATTENTION:
- Missing columns = false
- No active SMTP accounts
- Remaining capacity = 0
- Bounce rate > 20%
- Verified emails < 30%

❌ CRITICAL ISSUES:
- Missing tables = false
- RLS not enabled
- No SMTP accounts at all
- Bounce rate > 50%
- All emails are generic
*/
