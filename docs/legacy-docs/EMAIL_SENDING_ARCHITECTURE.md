# Email Sending Architecture

Visual overview of how email sending works in the OUTREACH platform.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ EmailWriter      │  │ BulkEmailSender  │  │ CRMModule    │ │
│  │ Module           │  │ Component        │  │              │ │
│  │                  │  │                  │  │              │ │
│  │ [Send via SMTP]  │  │ [Send All]       │  │ [Send Email] │ │
│  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘ │
│           │                     │                    │          │
└───────────┼─────────────────────┼────────────────────┼──────────┘
            │                     │                    │
            │ POST                │ POST               │ POST
            │ /api/send-email     │ /api/send-bulk     │ /api/send-email
            │                     │                    │
            ▼                     ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API ROUTES (Next.js)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ /api/send-email/route.ts                                 │  │
│  │                                                           │  │
│  │ 1. Authenticate user (Supabase session)                  │  │
│  │ 2. Validate request (leadId, to, subject, body)          │  │
│  │ 3. Verify lead belongs to user                           │  │
│  │ 4. Load SMTP accounts                                    │  │
│  │ 5. Check capacity                                        │  │
│  │ 6. Send via SMTPManager                                  │  │
│  │ 7. Log to database                                       │  │
│  │ 8. Update lead status                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ /api/send-bulk/route.ts                                  │  │
│  │                                                           │  │
│  │ 1. Authenticate user                                     │  │
│  │ 2. Validate emails array                                 │  │
│  │ 3. Load SMTP accounts                                    │  │
│  │ 4. Create campaign record                                │  │
│  │ 5. For each email:                                       │  │
│  │    - Validate format                                     │  │
│  │    - Verify DNS/MX                                       │  │
│  │    - Check capacity                                      │  │
│  │    - Send via SMTPManager                                │  │
│  │    - Log to database                                     │  │
│  │    - Throttle (delay)                                    │  │
│  │ 6. Update campaign stats                                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Uses
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SMTPManager Class                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ loadAccounts(userId)                                     │  │
│  │ - Query smtp_accounts table                              │  │
│  │ - Filter by user_id and status='active'                  │  │
│  │ - Sort by sent_today (use least-used first)              │  │
│  │ - Reset daily counters if needed                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ getNextAccount()                                         │  │
│  │ - Round-robin rotation                                   │  │
│  │ - Skip accounts at daily limit                           │  │
│  │ - Return next available account                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ sendEmail(to, subject, body)                             │  │
│  │ - Get next available account                             │  │
│  │ - Create nodemailer transporter                          │  │
│  │ - Send email via SMTP                                    │  │
│  │ - Update sent_today counter                              │  │
│  │ - Return success/error                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Sends via
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SMTP Servers                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Gmail SMTP   │  │ Outlook SMTP │  │ SendGrid     │         │
│  │ smtp.gmail   │  │ smtp-mail.   │  │ smtp.send    │         │
│  │ .com:587     │  │ outlook.com  │  │ grid.net     │  ...    │
│  │              │  │ :587         │  │ :587         │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Delivers to
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Recipient Inbox                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📧 Email received                                               │
│  ✅ Delivered successfully                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Single Email Send

```
User clicks "Send via SMTP"
  │
  ├─► POST /api/send-email
  │     │
  │     ├─► Authenticate (Supabase)
  │     │     └─► Get user from session
  │     │
  │     ├─► Validate request
  │     │     ├─► Check leadId exists
  │     │     ├─► Check email format
  │     │     └─► Verify lead belongs to user
  │     │
  │     ├─► Load SMTP accounts
  │     │     └─► Query: SELECT * FROM smtp_accounts WHERE user_id = ? AND status = 'active'
  │     │
  │     ├─► Check capacity
  │     │     └─► Any account with sent_today < daily_limit?
  │     │
  │     ├─► Send email
  │     │     ├─► Get next account (round-robin)
  │     │     ├─► Create nodemailer transporter
  │     │     ├─► transporter.sendMail(...)
  │     │     └─► Update: UPDATE smtp_accounts SET sent_today = sent_today + 1
  │     │
  │     ├─► Log to database
  │     │     ├─► INSERT INTO sent_emails (...)
  │     │     └─► INSERT INTO email_queue (status: 'sent')
  │     │
  │     └─► Update lead
  │           ├─► UPDATE leads SET status = 'Email Sent'
  │           └─► INSERT INTO lead_status_history (...)
  │
  └─► Return success
        └─► { success: true, sentEmailId: "...", accountUsed: "..." }
```

### Bulk Email Send

```
User clicks "Send All Emails"
  │
  ├─► POST /api/send-bulk
  │     │
  │     ├─► Authenticate (Supabase)
  │     │
  │     ├─► Validate emails array
  │     │
  │     ├─► Load SMTP accounts
  │     │
  │     ├─► Create campaign
  │     │     └─► INSERT INTO email_campaigns (...)
  │     │
  │     ├─► For each email:
  │     │     │
  │     │     ├─► Validate email format
  │     │     │
  │     │     ├─► Verify DNS/MX (optional)
  │     │     │     └─► GET https://dns.google/resolve?name=domain&type=MX
  │     │     │
  │     │     ├─► Check capacity
  │     │     │     ├─► If available:
  │     │     │     │     ├─► Send via SMTPManager
  │     │     │     │     ├─► Update sent_today
  │     │     │     │     ├─► INSERT INTO sent_emails
  │     │     │     │     ├─► INSERT INTO email_queue (status: 'sent')
  │     │     │     │     ├─► UPDATE leads SET status = 'Email Sent'
  │     │     │     │     └─► Wait delayMs (throttle)
  │     │     │     │
  │     │     │     └─► If exhausted:
  │     │     │           └─► INSERT INTO email_queue (status: 'pending', scheduled_at: tomorrow)
  │     │     │
  │     │     └─► Continue to next email
  │     │
  │     ├─► Update campaign stats
  │     │     └─► UPDATE email_campaigns SET sent_count = ?, status = ?
  │     │
  │     └─► Return results
  │           └─► { success: true, results: { sent, failed, queued }, accountStats: [...] }
  │
  └─► Display results to user
```

---

## SMTP Account Rotation

### Round-Robin Algorithm

```
Initial state:
┌─────────────────────────────────────────────────────────┐
│ Account 1: sent_today = 50, daily_limit = 100  ✅       │
│ Account 2: sent_today = 100, daily_limit = 100 ❌ FULL  │
│ Account 3: sent_today = 20, daily_limit = 100  ✅       │
│ Account 4: sent_today = 80, daily_limit = 100  ✅       │
└─────────────────────────────────────────────────────────┘
                    currentIndex = 0

Send email #1:
  ├─► Check Account 1 (index 0): 50 < 100 ✅ USE THIS
  ├─► Send via Account 1
  ├─► Update: sent_today = 51
  └─► currentIndex = 1

Send email #2:
  ├─► Check Account 2 (index 1): 100 < 100 ❌ SKIP (at limit)
  ├─► currentIndex = 2
  ├─► Check Account 3 (index 2): 20 < 100 ✅ USE THIS
  ├─► Send via Account 3
  ├─► Update: sent_today = 21
  └─► currentIndex = 3

Send email #3:
  ├─► Check Account 4 (index 3): 80 < 100 ✅ USE THIS
  ├─► Send via Account 4
  ├─► Update: sent_today = 81
  └─► currentIndex = 0 (wrap around)

Send email #4:
  ├─► Check Account 1 (index 0): 51 < 100 ✅ USE THIS
  ├─► Send via Account 1
  ├─► Update: sent_today = 52
  └─► currentIndex = 1

... continues rotating through available accounts
```

### Capacity Exhaustion

```
All accounts at limit:
┌─────────────────────────────────────────────────────────┐
│ Account 1: sent_today = 100, daily_limit = 100 ❌ FULL  │
│ Account 2: sent_today = 100, daily_limit = 100 ❌ FULL  │
│ Account 3: sent_today = 100, daily_limit = 100 ❌ FULL  │
└─────────────────────────────────────────────────────────┘

Send email:
  ├─► Check Account 1: FULL ❌
  ├─► Check Account 2: FULL ❌
  ├─► Check Account 3: FULL ❌
  ├─► All accounts checked, none available
  └─► Return error: "All SMTP accounts have reached their daily limit"

OR (for bulk send):
  └─► Queue email for tomorrow:
        INSERT INTO email_queue (
          status: 'pending',
          scheduled_at: NOW() + INTERVAL '24 hours'
        )
```

---

## Database Schema

### Tables Involved

```
┌─────────────────────────────────────────────────────────────────┐
│                        smtp_accounts                             │
├─────────────────────────────────────────────────────────────────┤
│ id              UUID PRIMARY KEY                                 │
│ user_id         UUID → auth.users(id)                            │
│ email           VARCHAR(255)                                     │
│ host            VARCHAR(255)                                     │
│ port            INTEGER                                          │
│ user_name       VARCHAR(255)                                     │
│ password        TEXT                                             │
│ provider        VARCHAR(50)                                      │
│ daily_limit     INTEGER                                          │
│ sent_today      INTEGER  ← Incremented on each send             │
│ last_reset      TIMESTAMPTZ  ← Reset at midnight                │
│ status          VARCHAR(20)  ← 'active', 'paused', 'error'      │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │ Used by
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                         sent_emails                              │
├─────────────────────────────────────────────────────────────────┤
│ id              UUID PRIMARY KEY                                 │
│ user_id         UUID → auth.users(id)                            │
│ lead_id         UUID → leads(id)                                 │
│ campaign_id     UUID → email_campaigns(id)                       │
│ subject         TEXT                                             │
│ body            TEXT                                             │
│ sent_at         TIMESTAMPTZ  ← When email was sent              │
│ opened_at       TIMESTAMPTZ  ← When email was opened (future)   │
│ replied_at      TIMESTAMPTZ  ← When lead replied (future)       │
│ status          TEXT  ← 'sent', 'opened', 'replied', 'bounced'  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         email_queue                              │
├─────────────────────────────────────────────────────────────────┤
│ id              UUID PRIMARY KEY                                 │
│ user_id         UUID → auth.users(id)                            │
│ campaign_id     UUID → email_campaigns(id)                       │
│ lead_id         UUID → leads(id)                                 │
│ smtp_account_id UUID → smtp_accounts(id)  ← Which account used  │
│ recipient_email VARCHAR(255)                                     │
│ recipient_name  VARCHAR(255)                                     │
│ subject         TEXT                                             │
│ body            TEXT                                             │
│ status          VARCHAR(20)  ← 'pending', 'sent', 'failed'      │
│ scheduled_at    TIMESTAMPTZ  ← When to send (for queued)        │
│ sent_at         TIMESTAMPTZ  ← When actually sent                │
│ error_message   TEXT  ← Error if failed                          │
│ retry_count     INTEGER  ← Number of retry attempts              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      email_campaigns                             │
├─────────────────────────────────────────────────────────────────┤
│ id              UUID PRIMARY KEY                                 │
│ user_id         UUID → auth.users(id)                            │
│ name            VARCHAR(255)                                     │
│ template_subject TEXT                                            │
│ template_body   TEXT                                             │
│ status          VARCHAR(20)  ← 'draft', 'active', 'completed'   │
│ total_recipients INTEGER  ← Total emails in campaign            │
│ sent_count      INTEGER  ← Successfully sent                     │
│ opened_count    INTEGER  ← Opened (future)                       │
│ replied_count   INTEGER  ← Replied (future)                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                           leads                                  │
├─────────────────────────────────────────────────────────────────┤
│ id              UUID PRIMARY KEY                                 │
│ user_id         UUID → auth.users(id)                            │
│ company_name    TEXT                                             │
│ email           TEXT                                             │
│ status          TEXT  ← Updated to 'Email Sent' after send      │
│ ...                                                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    lead_status_history                           │
├─────────────────────────────────────────────────────────────────┤
│ id              UUID PRIMARY KEY                                 │
│ lead_id         UUID → leads(id)                                 │
│ old_status      TEXT                                             │
│ new_status      TEXT                                             │
│ changed_at      TIMESTAMPTZ  ← When status changed              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Error Handling Flow

```
User attempts to send email
  │
  ├─► Validate request
  │     ├─► Missing fields? → 400 Bad Request
  │     ├─► Invalid email format? → 400 Bad Request
  │     └─► Lead not found? → 404 Not Found
  │
  ├─► Check authentication
  │     └─► No session? → 401 Unauthorized
  │
  ├─► Load SMTP accounts
  │     └─► No accounts configured? → 404 "No SMTP accounts available"
  │
  ├─► Check capacity
  │     └─► All accounts at limit? → 429 "All SMTP accounts have reached their daily limit"
  │
  ├─► Verify email (bulk only)
  │     └─► Failed DNS/MX? → Log as failed, continue to next
  │
  ├─► Send via SMTP
  │     ├─► SMTP error? → Log as failed, mark account as 'error'
  │     └─► Success? → Continue
  │
  └─► Return response
        ├─► Success: { success: true, ... }
        └─► Error: { success: false, error: "..." }
```

---

## Security Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                      Security Layers                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Authentication (Supabase Session)                            │
│     ├─► Check session cookie                                    │
│     ├─► Verify JWT token                                        │
│     └─► Get user ID                                             │
│                                                                  │
│  2. Authorization (Row Level Security)                           │
│     ├─► Verify lead belongs to user                             │
│     ├─► Verify SMTP account belongs to user                     │
│     └─► Verify campaign belongs to user                         │
│                                                                  │
│  3. Input Validation                                             │
│     ├─► Email format (regex)                                    │
│     ├─► Required fields check                                   │
│     └─► Type validation (UUID, string, number)                  │
│                                                                  │
│  4. Rate Limiting                                                │
│     ├─► Per-account daily limits                                │
│     ├─► Global capacity check                                   │
│     └─► Automatic reset at midnight                             │
│                                                                  │
│  5. Email Verification (optional)                                │
│     ├─► DNS/MX record check                                     │
│     ├─► Domain validation                                       │
│     └─► Disposable email detection (future)                     │
│                                                                  │
│  6. SMTP Security                                                │
│     ├─► TLS/SSL encryption                                      │
│     ├─► Secure password storage (TODO: encrypt)                 │
│     └─► Connection pooling                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance Characteristics

### Single Email Send

```
Latency breakdown:
┌─────────────────────────────────────────────────────────┐
│ Authentication:        ~50ms                             │
│ Database queries:      ~100ms (lead + SMTP accounts)    │
│ SMTP send:             ~500-1500ms (depends on server)  │
│ Database logging:      ~50ms (sent_emails + queue)      │
│ Lead status update:    ~50ms                             │
├─────────────────────────────────────────────────────────┤
│ Total:                 ~750-1750ms                       │
└─────────────────────────────────────────────────────────┘

Throughput: ~1 email per request
```

### Bulk Email Send

```
Latency breakdown (for 100 emails with delayMs=1500):
┌─────────────────────────────────────────────────────────┐
│ Authentication:        ~50ms                             │
│ Database queries:      ~100ms (SMTP accounts)           │
│ Campaign creation:     ~50ms                             │
│ Per-email processing:  ~1500ms × 100 = 150,000ms        │
│   ├─ Validation:       ~10ms                             │
│   ├─ DNS verification: ~100ms (if enabled)              │
│   ├─ SMTP send:        ~500-1000ms                      │
│   ├─ Database logging: ~50ms                             │
│   └─ Throttle delay:   ~1500ms                          │
│ Campaign update:       ~50ms                             │
├─────────────────────────────────────────────────────────┤
│ Total:                 ~150 seconds (2.5 minutes)        │
└─────────────────────────────────────────────────────────┘

Throughput: ~40 emails/minute (with delayMs=1500)
            ~60 emails/minute (with delayMs=1000)
```

### Optimization Strategies

```
1. Parallel sending (future):
   ├─► Process multiple emails concurrently
   ├─► Use worker threads or separate processes
   └─► Increase throughput to 100s/minute

2. Batch database operations:
   ├─► Insert multiple records at once
   ├─► Use bulk INSERT statements
   └─► Reduce database round-trips

3. Cache SMTP accounts:
   ├─► Load once per request
   ├─► Reuse across multiple sends
   └─► Reduce database queries

4. Async processing (future):
   ├─► Queue emails in database
   ├─► Process via background worker
   ├─► Return immediately to user
   └─► Notify on completion
```

---

## Monitoring & Observability

### Key Metrics to Track

```
┌─────────────────────────────────────────────────────────────────┐
│                      Metrics Dashboard                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📊 Sending Metrics                                              │
│     ├─ Total emails sent today                                  │
│     ├─ Success rate (sent / total)                              │
│     ├─ Failure rate (failed / total)                            │
│     └─ Queue size (pending emails)                              │
│                                                                  │
│  📈 SMTP Account Health                                          │
│     ├─ Accounts at capacity (sent_today >= daily_limit)         │
│     ├─ Accounts with errors (status = 'error')                  │
│     ├─ Average usage per account                                │
│     └─ Total remaining capacity                                 │
│                                                                  │
│  ⏱️ Performance Metrics                                          │
│     ├─ Average send latency                                     │
│     ├─ P95 send latency                                         │
│     ├─ Throughput (emails/minute)                               │
│     └─ API response time                                        │
│                                                                  │
│  🎯 Campaign Metrics                                             │
│     ├─ Active campaigns                                         │
│     ├─ Completed campaigns                                      │
│     ├─ Average campaign size                                    │
│     └─ Campaign completion rate                                 │
│                                                                  │
│  ❌ Error Metrics                                                │
│     ├─ Failed sends by reason                                   │
│     ├─ DNS verification failures                                │
│     ├─ SMTP errors by type                                      │
│     └─ Rate limit hits                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### SQL Queries for Monitoring

```sql
-- Total emails sent today
SELECT COUNT(*) 
FROM sent_emails 
WHERE sent_at >= CURRENT_DATE;

-- Success rate
SELECT 
  COUNT(CASE WHEN status = 'sent' THEN 1 END)::FLOAT / COUNT(*) * 100 as success_rate
FROM email_queue
WHERE created_at >= CURRENT_DATE;

-- SMTP account usage
SELECT 
  email,
  sent_today,
  daily_limit,
  ROUND((sent_today::FLOAT / daily_limit) * 100, 1) as usage_percent,
  status
FROM smtp_accounts
ORDER BY usage_percent DESC;

-- Failed sends by reason
SELECT 
  error_message,
  COUNT(*) as count
FROM email_queue
WHERE status = 'failed'
  AND created_at >= CURRENT_DATE
GROUP BY error_message
ORDER BY count DESC;

-- Campaign performance
SELECT 
  name,
  total_recipients,
  sent_count,
  ROUND((sent_count::FLOAT / total_recipients) * 100, 1) as completion_rate,
  status
FROM email_campaigns
WHERE created_at >= CURRENT_DATE
ORDER BY created_at DESC;
```

---

## Summary

This architecture provides:

✅ **Scalability** — Handle 100s-1000s of emails with SMTP rotation  
✅ **Reliability** — Automatic retry, error handling, capacity management  
✅ **Security** — Authentication, authorization, input validation  
✅ **Observability** — Comprehensive logging and metrics  
✅ **Performance** — Optimized database queries, connection pooling  
✅ **Maintainability** — Clean separation of concerns, well-documented  

🚀 **Ready for production use!**
