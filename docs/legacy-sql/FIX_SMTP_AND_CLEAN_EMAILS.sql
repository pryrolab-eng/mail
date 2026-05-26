-- ============================================================
-- FIX SMTP ACCOUNTS AND CLEAN BAD EMAILS
-- Run this in Supabase SQL Editor
-- ============================================================

-- STEP 1: Reset all SMTP accounts to active
-- This fixes the issue where accounts were disabled after first failure
UPDATE smtp_accounts
SET status = 'active',
    last_error = NULL
WHERE status = 'error';

-- Check SMTP accounts status
SELECT 
  email,
  status,
  sent_today,
  daily_limit,
  (sent_today::float / daily_limit * 100)::int as usage_percent,
  last_error,
  last_reset
FROM smtp_accounts
ORDER BY status, email;

-- ============================================================
-- STEP 2: Analyze recent email failures
-- ============================================================

-- See why emails failed
SELECT 
  bounce_reason,
  COUNT(*) as failure_count
FROM sent_emails
WHERE status = 'failed'
AND sent_at > NOW() - INTERVAL '24 hours'
GROUP BY bounce_reason
ORDER BY failure_count DESC;

-- See which emails failed
SELECT 
  to_email,
  subject,
  bounce_reason,
  sent_at
FROM sent_emails
WHERE status = 'failed'
AND sent_at > NOW() - INTERVAL '24 hours'
ORDER BY sent_at DESC
LIMIT 50;

-- ============================================================
-- STEP 3: Identify bad email patterns
-- ============================================================

-- Find generated/fake emails in your leads
SELECT 
  company_name,
  email,
  niche,
  location,
  confidence_score,
  email_verified
FROM leads
WHERE email LIKE 'info@%'
   OR email LIKE 'contact@%'
   OR email LIKE 'hello@%'
   OR email LIKE 'support@%'
   OR email LIKE 'admin@%'
ORDER BY company_name;

-- Count by pattern
SELECT 
  CASE 
    WHEN email LIKE 'info@%' THEN 'info@'
    WHEN email LIKE 'contact@%' THEN 'contact@'
    WHEN email LIKE 'hello@%' THEN 'hello@'
    WHEN email LIKE 'support@%' THEN 'support@'
    WHEN email LIKE 'admin@%' THEN 'admin@'
    ELSE 'other'
  END as email_pattern,
  COUNT(*) as count
FROM leads
WHERE email IS NOT NULL
GROUP BY email_pattern
ORDER BY count DESC;

-- ============================================================
-- STEP 4: Mark suspicious emails for review
-- ============================================================

-- Mark generated emails as low confidence
UPDATE leads
SET confidence_score = 30,
    email_verified = false
WHERE (
  email LIKE 'info@%'
  OR email LIKE 'contact@%'
  OR email LIKE 'hello@%'
  OR email LIKE 'support@%'
  OR email LIKE 'admin@%'
)
AND confidence_score > 30;

-- ============================================================
-- STEP 5: Remove emails that have bounced multiple times
-- ============================================================

-- Find emails that bounced multiple times
SELECT 
  to_email,
  COUNT(*) as bounce_count,
  MAX(bounce_reason) as last_bounce_reason
FROM sent_emails
WHERE status = 'failed'
GROUP BY to_email
HAVING COUNT(*) >= 2
ORDER BY bounce_count DESC;

-- Mark leads with bounced emails as 'bounced'
UPDATE leads
SET status = 'bounced'
WHERE email IN (
  SELECT to_email
  FROM sent_emails
  WHERE status = 'failed'
  GROUP BY to_email
  HAVING COUNT(*) >= 2
);

-- ============================================================
-- STEP 6: Get statistics
-- ============================================================

-- Overall email quality
SELECT 
  COUNT(*) as total_leads,
  COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as with_email,
  COUNT(CASE WHEN email_verified = true THEN 1 END) as verified,
  COUNT(CASE WHEN confidence_score >= 50 THEN 1 END) as good_quality,
  COUNT(CASE WHEN confidence_score < 50 THEN 1 END) as poor_quality,
  COUNT(CASE WHEN status = 'bounced' THEN 1 END) as bounced
FROM leads;

-- Email sending statistics (last 24 hours)
SELECT 
  COUNT(*) as total_sent,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as delivered,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
  COUNT(CASE WHEN status = 'bounced' THEN 1 END) as bounced,
  ROUND(COUNT(CASE WHEN status = 'failed' THEN 1 END)::numeric / COUNT(*) * 100, 2) as failure_rate_percent
FROM sent_emails
WHERE sent_at > NOW() - INTERVAL '24 hours';

-- ============================================================
-- STEP 7: Recommendations
-- ============================================================

-- Leads that need verification
SELECT 
  COUNT(*) as needs_verification,
  'Run Email Verification on these leads' as action
FROM leads
WHERE email IS NOT NULL
AND (email_verified = false OR email_verified IS NULL)
AND status NOT IN ('bounced', 'failed');

-- Leads ready to contact
SELECT 
  COUNT(*) as ready_to_contact,
  'These leads are verified and ready' as action
FROM leads
WHERE email_verified = true
AND confidence_score >= 50
AND status IN ('new', 'contacted');

-- ============================================================
-- OPTIONAL: Clean up old failed emails (use with caution)
-- ============================================================

-- Uncomment to delete failed email records older than 7 days
-- DELETE FROM sent_emails
-- WHERE status = 'failed'
-- AND sent_at < NOW() - INTERVAL '7 days';

-- ============================================================
-- SUMMARY
-- ============================================================

SELECT 
  '✅ SMTP accounts reset to active' as step_1,
  '📊 Email failures analyzed' as step_2,
  '🔍 Bad email patterns identified' as step_3,
  '⚠️  Suspicious emails marked' as step_4,
  '🚫 Bounced emails removed' as step_5,
  '📈 Statistics generated' as step_6,
  '💡 Next: Run Email Verification module' as step_7;
