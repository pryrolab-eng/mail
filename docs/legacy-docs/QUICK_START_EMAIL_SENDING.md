# Quick Start: Email Sending

This guide shows you how to test the newly added email sending functionality.

---

## Prerequisites

Before you can send emails, you need:

1. ✅ **Supabase project** — Already configured (`.env.local` has credentials)
2. ✅ **User account** — Sign up at `/sign-up`
3. ✅ **SMTP account** — Add at least one Gmail account
4. ✅ **Leads in CRM** — Add some test leads

---

## Step 1: Add an SMTP Account

### Option A: Use Gmail (Recommended for Testing)

1. Go to **Dashboard → SMTP Manager**
2. Click **"Add SMTP Account"**
3. Fill in:
   - **Email:** `your-email@gmail.com`
   - **Host:** `smtp.gmail.com`
   - **Port:** `587`
   - **Username:** `your-email@gmail.com`
   - **Password:** Your Gmail App Password (see below)
   - **Provider:** `gmail`
   - **Daily Limit:** `100` (Gmail's limit)

### How to Get Gmail App Password

1. Go to [Google Account Security](https://myaccount.google.com/security)
2. Enable **2-Step Verification** (required)
3. Go to **App Passwords**
4. Generate a new app password for "Mail"
5. Copy the 16-character password
6. Use this password in the SMTP form (NOT your regular Gmail password)

### Option B: Use Other SMTP Providers

**Outlook/Hotmail:**
- Host: `smtp-mail.outlook.com`
- Port: `587`
- Username: Your full email
- Password: Your Outlook password

**SendGrid:**
- Host: `smtp.sendgrid.net`
- Port: `587`
- Username: `apikey`
- Password: Your SendGrid API key

**Mailgun:**
- Host: `smtp.mailgun.org`
- Port: `587`
- Username: Your Mailgun SMTP username
- Password: Your Mailgun SMTP password

---

## Step 2: Add Test Leads

### Option A: Use the Scraper

1. Go to **Dashboard → Scraper**
2. Enter:
   - **Niche:** `coffee shops`
   - **Location:** `San Francisco`
3. Click **"Scrape Leads"**
4. Wait for results
5. Click **"Import to CRM"**

### Option B: Add Manually

1. Go to **Dashboard → CRM**
2. Click **"Add Lead"** (if available)
3. Or insert directly into database:

```sql
INSERT INTO leads (
  user_id, 
  company_name, 
  email, 
  niche, 
  location, 
  company_context, 
  status
) VALUES (
  'your-user-id',
  'Test Company',
  'test@example.com',
  'Technology',
  'San Francisco',
  'A test company for email sending',
  'New'
);
```

---

## Step 3: Send a Single Email

### Using Email Writer

1. Go to **Dashboard → Email Writer**
2. Select **"Single Email"** mode (default)
3. Select a lead from the dropdown
4. Choose a tone: **Direct**, **Aggressive**, or **Surgical**
5. (Optional) Enter a custom pain point
6. Click **"Generate Email"**
7. Review the generated email
8. (Optional) Click **"Edit"** to customize
9. Click **"Send via SMTP"** button
10. Wait for success toast: `"Email sent to [email] via [smtp-account]"`

### What Happens Behind the Scenes

```
1. POST /api/send-email
2. Authenticate user
3. Validate lead and email
4. Load SMTP accounts
5. Check capacity (sent_today < daily_limit)
6. Send via nodemailer
7. Update sent_today counter
8. Insert into sent_emails table
9. Update lead status to "Email Sent"
10. Return success
```

### Verify in Database

```sql
-- Check sent email
SELECT * FROM sent_emails 
WHERE user_id = 'your-user-id' 
ORDER BY sent_at DESC 
LIMIT 1;

-- Check email queue log
SELECT * FROM email_queue 
WHERE user_id = 'your-user-id' 
ORDER BY created_at DESC 
LIMIT 1;

-- Check lead status updated
SELECT company_name, status 
FROM leads 
WHERE id = 'your-lead-id';

-- Check SMTP account usage
SELECT email, sent_today, daily_limit 
FROM smtp_accounts 
WHERE user_id = 'your-user-id';
```

---

## Step 4: Send Bulk Emails

### Using Bulk Email Generator

1. Go to **Dashboard → Email Writer**
2. Click **"Bulk Email Generator"** tab
3. Enter:
   - **Your Company Name:** `Acme Solutions`
   - **Your Service/Product:** `AI-powered marketing automation`
4. Choose a tone: **Direct**, **Aggressive**, or **Surgical**
5. (Optional) Enter a custom pain point
6. Select leads using checkboxes (or click "Select All")
7. Click **"Generate X Personalized Emails"**
8. Wait for AI to generate emails (uses your configured AI provider)
9. Review preview (use arrows to see all emails)
10. Click **"Send Test"** to send one email to yourself (optional)
11. Click **"Send All X Emails"**
12. Wait for completion (shows progress)
13. Review results: sent, failed, queued counts

### What Happens Behind the Scenes

```
1. POST /api/send-bulk with array of emails
2. Authenticate user
3. Load SMTP accounts
4. Create email_campaigns record
5. For each email:
   a. Validate email format
   b. Verify DNS/MX records (checks if domain accepts email)
   c. Check SMTP capacity
   d. If capacity available:
      - Send via next SMTP account (round-robin)
      - Update sent_today counter
      - Insert into email_queue (status: 'sent')
      - Insert into sent_emails
      - Update lead status to "Email Sent"
      - Wait 1500ms (throttle)
   e. If capacity exhausted:
      - Insert into email_queue (status: 'pending', scheduled_at: tomorrow)
6. Update campaign stats
7. Return results + account stats
```

### Verify in Database

```sql
-- Check campaign
SELECT * FROM email_campaigns 
WHERE user_id = 'your-user-id' 
ORDER BY created_at DESC 
LIMIT 1;

-- Check sent emails
SELECT status, COUNT(*) 
FROM email_queue 
WHERE campaign_id = 'campaign-id' 
GROUP BY status;

-- Check SMTP account rotation
SELECT sa.email, COUNT(*) as emails_sent
FROM email_queue eq
JOIN smtp_accounts sa ON eq.smtp_account_id = sa.id
WHERE eq.campaign_id = 'campaign-id'
GROUP BY sa.email;

-- Check lead statuses updated
SELECT status, COUNT(*) 
FROM leads 
WHERE user_id = 'your-user-id' 
GROUP BY status;
```

---

## Step 5: Monitor SMTP Usage

### Check Account Stats

1. Go to **Dashboard → SMTP Manager**
2. View all accounts with:
   - Email address
   - Status (active, paused, error)
   - Sent today / Daily limit
   - Usage percentage

### Check in Database

```sql
-- View all SMTP accounts
SELECT 
  email,
  status,
  sent_today,
  daily_limit,
  ROUND((sent_today::FLOAT / daily_limit) * 100, 1) as usage_percent,
  last_reset
FROM smtp_accounts
WHERE user_id = 'your-user-id'
ORDER BY sent_today DESC;

-- Check total capacity
SELECT 
  SUM(daily_limit) as total_limit,
  SUM(sent_today) as total_sent,
  SUM(daily_limit - sent_today) as remaining
FROM smtp_accounts
WHERE user_id = 'your-user-id' 
AND status = 'active';
```

---

## Troubleshooting

### "No SMTP accounts available"

**Cause:** You haven't added any SMTP accounts yet

**Fix:**
1. Go to SMTP Manager
2. Add at least one SMTP account
3. Make sure status is "active"

---

### "All SMTP accounts have reached their daily limit"

**Cause:** All your SMTP accounts have sent their daily limit

**Fix:**
- **Wait until tomorrow** — counters reset at midnight
- **Add more SMTP accounts** — increase total capacity
- **Increase daily limits** — edit existing accounts (be careful not to exceed provider limits)

---

### "Failed DNS/MX verification"

**Cause:** The recipient's email domain doesn't have MX records (can't receive email)

**Fix:**
- **Check the email address** — make sure it's correct
- **Disable verification** — set `verifyEmails: false` in bulk send (not recommended)

---

### "Invalid recipient email address"

**Cause:** Email format is invalid (e.g., missing @, no domain)

**Fix:**
- Check the lead's email in CRM
- Update to a valid email format

---

### Gmail "Username and Password not accepted"

**Cause:** Using regular Gmail password instead of App Password

**Fix:**
1. Enable 2-Step Verification on your Google Account
2. Generate an App Password
3. Use the 16-character App Password (not your regular password)

---

### Emails sending but not arriving

**Possible causes:**
1. **Spam folder** — check recipient's spam/junk folder
2. **Blocked sender** — recipient's email provider blocked your SMTP server
3. **Invalid SPF/DKIM** — your domain isn't properly configured

**Fix:**
- Send a test email to yourself first
- Check spam folder
- Use a reputable SMTP provider (Gmail, SendGrid, Mailgun)
- Set up SPF and DKIM records for your domain

---

## Testing Checklist

### Single Email Send
- [ ] Add SMTP account
- [ ] Add test lead
- [ ] Generate email in Email Writer
- [ ] Click "Send via SMTP"
- [ ] Verify success toast
- [ ] Check `sent_emails` table
- [ ] Check lead status updated to "Email Sent"
- [ ] Check SMTP account `sent_today` incremented

### Bulk Email Send
- [ ] Add multiple SMTP accounts (for rotation testing)
- [ ] Add multiple test leads (10+)
- [ ] Generate bulk emails
- [ ] Review preview
- [ ] Send test email to yourself
- [ ] Send all emails
- [ ] Verify results (sent, failed, queued)
- [ ] Check `email_campaigns` table
- [ ] Check `email_queue` table
- [ ] Check SMTP rotation (emails distributed across accounts)

### SMTP Rotation
- [ ] Add 2-3 SMTP accounts with low limits (e.g., 5 each)
- [ ] Send 15 emails
- [ ] Verify emails distributed evenly across accounts
- [ ] Verify accounts at limit are skipped

### Daily Limit
- [ ] Set one account's `sent_today` to equal `daily_limit`
- [ ] Try to send email
- [ ] Verify at-capacity account is skipped
- [ ] Verify next available account is used

### Email Verification
- [ ] Try to send to invalid email: `test@fakeinvaliddomainthatdoesnotexist.com`
- [ ] Verify fails with "Failed DNS/MX verification"
- [ ] Check `email_queue` shows `status: 'failed'`

---

## API Testing (Advanced)

### Test with cURL

**Single Email:**
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

**Bulk Email:**
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
      }
    ],
    "delayMs": 1000,
    "verifyEmails": false
  }'
```

### Get Session Token

1. Open browser DevTools (F12)
2. Go to Application → Cookies
3. Find `sb-access-token` cookie
4. Copy the value
5. Use in cURL `-H "Cookie: sb-access-token=VALUE"`

---

## Next Steps

Once email sending is working:

1. **Add email tracking** — track opens and clicks
2. **Add unsubscribe links** — comply with CAN-SPAM
3. **Set up follow-up sequences** — automate follow-ups
4. **Monitor bounce rates** — handle bounced emails
5. **Analyze campaign performance** — open rate, reply rate, etc.

---

## Support

If you encounter issues:

1. Check the browser console for errors
2. Check the server logs (`npm run dev` output)
3. Check the database tables (`sent_emails`, `email_queue`, `smtp_accounts`)
4. Review the full API documentation: `API_ROUTES_DOCUMENTATION.md`
5. Review the implementation summary: `EMAIL_SENDING_IMPLEMENTATION_SUMMARY.md`

---

## Summary

✅ **You can now:**
- Send single emails via SMTP from Email Writer
- Send bulk emails (100s-1000s) with automatic rotation
- Track all sends in database
- Monitor SMTP account usage
- Handle daily sending limits
- Verify email addresses before sending

🚀 **Ready to send your first cold email!**
