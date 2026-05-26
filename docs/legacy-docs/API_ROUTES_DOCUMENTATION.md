# Email Sending API Routes

This document describes the newly added email sending API routes for the OUTREACH platform.

## Overview

Two new API routes have been added to handle email sending via SMTP:

1. **`/api/send-email`** — Send a single email to one lead
2. **`/api/send-bulk`** — Send bulk emails to multiple leads with automatic SMTP rotation

Both routes:
- Require authentication (Supabase session)
- Use the `SMTPManager` class for multi-account rotation
- Respect daily sending limits per SMTP account
- Log all sends to `email_queue` and `sent_emails` tables
- Auto-update lead status to "Email Sent"
- Verify email addresses (DNS/MX record check for bulk)

---

## 1. `/api/send-email` — Single Email Send

**Method:** `POST`

**Authentication:** Required (Supabase session cookie)

### Request Body

```typescript
{
  leadId: string;        // UUID of the lead in the database
  to: string;            // Recipient email address
  subject: string;       // Email subject line
  body: string;          // Email body (HTML supported)
  campaignId?: string;   // Optional — link to a campaign
}
```

### Response

**Success (200):**
```typescript
{
  success: true;
  sentEmailId: string;   // UUID of the sent_emails record
  accountUsed: string;   // Email address of the SMTP account used
}
```

**Error (400/401/404/429/500):**
```typescript
{
  success: false;
  error: string;         // Human-readable error message
}
```

### Status Codes

- **200** — Email sent successfully
- **400** — Invalid request (missing fields, invalid email format)
- **401** — Unauthorized (no session)
- **404** — Lead not found or access denied
- **429** — All SMTP accounts at daily limit
- **500** — Internal server error

### Example Usage

```typescript
const response = await fetch("/api/send-email", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    leadId: "123e4567-e89b-12d3-a456-426614174000",
    to: "john@example.com",
    subject: "Quick question about your business",
    body: "<p>Hi John,</p><p>I noticed your company...</p>",
  }),
});

const data = await response.json();

if (data.success) {
  console.log(`Email sent via ${data.accountUsed}`);
} else {
  console.error(data.error);
}
```

### What It Does

1. Authenticates the user via Supabase session
2. Validates the request body (required fields, email format)
3. Verifies the lead belongs to the authenticated user
4. Loads all active SMTP accounts for the user
5. Checks if any account has remaining daily capacity
6. Sends the email using the next available SMTP account (round-robin)
7. Records the send in `sent_emails` table
8. Updates the lead status to "Email Sent" (if currently "New")
9. Logs status change in `lead_status_history`
10. Returns the sent email ID and account used

---

## 2. `/api/send-bulk` — Bulk Email Send

**Method:** `POST`

**Authentication:** Required (Supabase session cookie)

### Request Body

```typescript
{
  emails: Array<{
    leadId: string;       // UUID of the lead
    to: string;           // Recipient email
    companyName: string;  // Company name (for logging)
    subject: string;      // Email subject
    body: string;         // Email body (HTML supported)
  }>;
  delayMs?: number;       // Delay between sends (default: 1500ms)
  verifyEmails?: boolean; // DNS/MX verification (default: true)
}
```

### Response

**Success (200):**
```typescript
{
  success: true;
  results: {
    total: number;        // Total emails in request
    sent: number;         // Successfully sent
    failed: number;       // Failed to send
    queued: number;       // Queued for tomorrow (capacity reached)
    errors: string[];     // Array of error messages
  };
  campaignId: string;     // UUID of the created campaign
  accountStats: Array<{   // SMTP account usage stats
    email: string;
    sent: number;
    limit: number;
    percentage: number;
    status: string;
  }>;
}
```

**Error (400/401/429/500):**
```typescript
{
  success: false;
  error: string;
}
```

### Status Codes

- **200** — Bulk send completed (check `results` for per-email status)
- **400** — Invalid request (empty emails array)
- **401** — Unauthorized
- **429** — All SMTP accounts at daily limit (before starting)
- **500** — Internal server error

### Example Usage

```typescript
const response = await fetch("/api/send-bulk", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    emails: [
      {
        leadId: "lead-uuid-1",
        to: "john@company1.com",
        companyName: "Company 1",
        subject: "Partnership opportunity",
        body: "<p>Hi John...</p>",
      },
      {
        leadId: "lead-uuid-2",
        to: "jane@company2.com",
        companyName: "Company 2",
        subject: "Partnership opportunity",
        body: "<p>Hi Jane...</p>",
      },
      // ... up to 1000s of emails
    ],
    delayMs: 2000,        // 2 seconds between sends
    verifyEmails: true,   // Verify DNS/MX records
  }),
});

const data = await response.json();

if (data.success) {
  console.log(`Sent: ${data.results.sent}, Failed: ${data.results.failed}, Queued: ${data.results.queued}`);
  console.log("Account stats:", data.accountStats);
} else {
  console.error(data.error);
}
```

### What It Does

1. Authenticates the user
2. Validates the emails array
3. Loads all active SMTP accounts
4. Creates a new `email_campaigns` record to group this batch
5. For each email:
   - Validates email format
   - Optionally verifies DNS/MX records (checks if domain accepts email)
   - Checks remaining SMTP capacity
   - If capacity available: sends via next SMTP account (round-robin)
   - If capacity exhausted: queues for tomorrow
   - Logs to `email_queue` and `sent_emails` tables
   - Updates lead status to "Email Sent"
   - Throttles with configurable delay between sends
6. Updates campaign stats (sent_count, status)
7. Returns detailed results and account usage stats

### Email Verification

When `verifyEmails: true` (default), the route performs DNS/MX record lookups using Google's public DNS API to check if the recipient domain accepts email. This helps avoid:
- Typos in email addresses
- Fake/non-existent domains
- Bounces that hurt sender reputation

Invalid emails are marked as `failed` and logged with error "Failed DNS/MX verification".

### Capacity Management

If all SMTP accounts reach their daily limit mid-batch:
- Remaining emails are queued with `status: 'pending'`
- `scheduled_at` is set to 24 hours from now
- These can be processed by a cron job the next day

### Throttling

The `delayMs` parameter adds a delay between each send to:
- Avoid triggering spam filters
- Spread load across SMTP servers
- Appear more "human" to email providers

Recommended values:
- **1000-2000ms** for bulk campaigns (500-1000 emails/hour)
- **500-1000ms** for smaller batches (<100 emails)
- **0ms** for test sends (not recommended for production)

---

## SMTP Account Rotation

Both routes use the `SMTPManager` class which implements:

1. **Round-robin rotation** — cycles through all active accounts
2. **Capacity checking** — skips accounts at daily limit
3. **Automatic reset** — resets `sent_today` counter at midnight
4. **Error handling** — marks accounts as `status: 'error'` if send fails

### How It Works

```
User has 3 SMTP accounts:
- account1@gmail.com (limit: 100, sent: 50)
- account2@gmail.com (limit: 100, sent: 100) ← at limit
- account3@gmail.com (limit: 100, sent: 20)

Send order:
1. account1 (50 → 51)
2. account3 (20 → 21) ← skips account2 (at limit)
3. account1 (51 → 52)
4. account3 (21 → 22)
... continues round-robin between account1 and account3
```

---

## Database Schema

### `sent_emails` Table

Records every successfully sent email:

```sql
CREATE TABLE sent_emails (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  lead_id UUID REFERENCES leads(id),
  campaign_id UUID REFERENCES email_campaigns(id),
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  status TEXT -- 'sent', 'opened', 'replied', 'bounced'
);
```

### `email_queue` Table

Logs all send attempts (success, failure, queued):

```sql
CREATE TABLE email_queue (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  campaign_id UUID REFERENCES email_campaigns(id),
  lead_id UUID REFERENCES leads(id),
  smtp_account_id UUID REFERENCES smtp_accounts(id),
  recipient_email VARCHAR(255),
  recipient_name VARCHAR(255),
  subject TEXT,
  body TEXT,
  status VARCHAR(20), -- 'pending', 'sent', 'failed'
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER
);
```

### `smtp_accounts` Table

Stores SMTP credentials and tracks daily usage:

```sql
CREATE TABLE smtp_accounts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  email VARCHAR(255),
  host VARCHAR(255),
  port INTEGER,
  user_name VARCHAR(255),
  password TEXT,
  provider VARCHAR(50),
  daily_limit INTEGER,
  sent_today INTEGER,
  last_reset TIMESTAMPTZ,
  status VARCHAR(20) -- 'active', 'paused', 'error'
);
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Unauthorized` | No Supabase session | User must sign in |
| `Missing required fields` | Invalid request body | Check request format |
| `Invalid recipient email address` | Malformed email | Validate email format client-side |
| `Lead not found or access denied` | Wrong leadId or user doesn't own lead | Verify leadId and user permissions |
| `All SMTP accounts have reached their daily limit` | No capacity remaining | Add more SMTP accounts or wait until tomorrow |
| `No SMTP accounts available` | User has no active SMTP accounts | Add SMTP accounts in SMTP Manager |
| `Failed DNS/MX verification` | Invalid recipient domain | Email address is fake or domain doesn't accept email |

### Retry Logic

Failed emails are logged to `email_queue` with:
- `status: 'failed'`
- `error_message: <reason>`
- `retry_count: 0`

A background job can retry these later by:
1. Querying `email_queue` where `status = 'failed'` and `retry_count < 3`
2. Re-attempting send via `/api/send-email`
3. Incrementing `retry_count` on each attempt

---

## Security

### Authentication

Both routes verify the user's Supabase session:

```typescript
const supabase = await createClient();
const { data: { user }, error } = await supabase.auth.getUser();

if (error || !user) {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}
```

### Authorization

The routes verify the lead belongs to the authenticated user:

```typescript
const { data: lead } = await supabase
  .from("leads")
  .select("id")
  .eq("id", leadId)
  .eq("user_id", user.id)  // ← ensures user owns this lead
  .single();
```

### Rate Limiting

- **Per-account limits:** Each SMTP account has a `daily_limit` (default: 100)
- **Global limit:** Sum of all account limits (e.g., 60 accounts × 100 = 6,000/day)
- **Automatic reset:** `sent_today` resets to 0 at midnight

### SMTP Password Security

⚠️ **Current:** Passwords stored as plain text in database  
✅ **TODO:** Encrypt passwords using AES-256 before storing

---

## Testing

### Test Single Email Send

```bash
curl -X POST http://localhost:3000/api/send-email \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=YOUR_SESSION_TOKEN" \
  -d '{
    "leadId": "your-lead-uuid",
    "to": "test@example.com",
    "subject": "Test Email",
    "body": "<p>This is a test</p>"
  }'
```

### Test Bulk Send

```bash
curl -X POST http://localhost:3000/api/send-bulk \
  -H "Content-Type: application/json" \
  -H "Cookie: sb-access-token=YOUR_SESSION_TOKEN" \
  -d '{
    "emails": [
      {
        "leadId": "lead-1",
        "to": "test1@example.com",
        "companyName": "Test Co 1",
        "subject": "Test",
        "body": "<p>Test 1</p>"
      },
      {
        "leadId": "lead-2",
        "to": "test2@example.com",
        "companyName": "Test Co 2",
        "subject": "Test",
        "body": "<p>Test 2</p>"
      }
    ],
    "delayMs": 1000,
    "verifyEmails": false
  }'
```

---

## Next Steps

### Recommended Improvements

1. **Email tracking pixels** — Add `/api/track/open/:emailId` endpoint
2. **Click tracking** — Add `/api/track/click/:emailId/:linkId` redirect endpoint
3. **Unsubscribe links** — Add `/api/unsubscribe/:userId/:leadId` endpoint
4. **Webhook for bounces** — Handle SMTP bounce notifications
5. **Retry queue processor** — Cron job to retry failed sends
6. **Password encryption** — Encrypt SMTP passwords at rest
7. **Rate limiting middleware** — Add per-user rate limits (e.g., 10 requests/minute)
8. **Batch status endpoint** — Add `/api/send-bulk/:campaignId/status` to check progress

### Integration with UI

The following components now use these routes:

- **`EmailWriterModule.tsx`** — "Send via SMTP" button calls `/api/send-email`
- **`BulkEmailSender.tsx`** — "Send All Emails" button calls `/api/send-bulk`
- **`CRMModule.tsx`** — Can be extended to add "Send Email" action per lead

---

## Troubleshooting

### "No SMTP accounts available"

**Cause:** User has no SMTP accounts configured  
**Fix:** Go to SMTP Manager → Add Account → Enter Gmail credentials

### "All SMTP accounts have reached their daily limit"

**Cause:** All accounts have sent their `daily_limit` emails today  
**Fix:** 
- Wait until tomorrow (counters reset at midnight)
- Add more SMTP accounts
- Increase `daily_limit` for existing accounts

### "Failed DNS/MX verification"

**Cause:** Recipient domain has no MX records (can't receive email)  
**Fix:**
- Verify the email address is correct
- Disable verification: `verifyEmails: false` (not recommended)

### Emails not sending

**Debug checklist:**
1. Check SMTP account status: `SELECT * FROM smtp_accounts WHERE user_id = 'your-user-id'`
2. Check daily limits: `SELECT email, sent_today, daily_limit FROM smtp_accounts`
3. Check error logs: `SELECT * FROM email_queue WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`
4. Test SMTP credentials manually using a tool like [SMTP Tester](https://www.smtper.net/)

---

## Summary

✅ **Added:**
- `/api/send-email` — Single email send with SMTP rotation
- `/api/send-bulk` — Bulk email send with DNS verification and throttling
- Fixed `smtp_account_id` bug in `sendBulkEmailsChunkedAction`
- Added "Send via SMTP" button to `EmailWriterModule`
- Updated `BulkEmailSender` to use `/api/send-bulk`

✅ **Features:**
- Multi-account SMTP rotation (round-robin)
- Daily sending limits per account
- Automatic capacity checking
- DNS/MX email verification
- Configurable throttling
- Comprehensive error handling
- Database logging (sent_emails, email_queue)
- Auto-update lead status

🚀 **Ready for production** (with password encryption recommended)
