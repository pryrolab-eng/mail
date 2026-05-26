# Fix Test Email Send Issue

## Problem
The test send email feature in bulk email is not working.

## Root Causes Identified

1. **No SMTP Accounts Configured** - Most likely cause
2. **Data structure mismatch** - Fixed in the code
3. **Missing error messages** - Fixed to show better errors

## Solutions Applied

### 1. Fixed Data Structure
Updated `EmailWriterModule.tsx` to send the correct data format:
- Changed from `lead`, `model` fields to `lead_id`, `lead_email`, `company_name`
- Disabled email verification for test sends (faster)
- Added better error messages

### 2. Added Better Logging
Updated `smtp-server.ts` to log when no SMTP accounts are found.

### 3. Improved Error Handling
Now shows specific error if no SMTP accounts are configured.

## How to Fix

### Step 1: Check if SMTP Accounts Exist
Run this SQL in your Supabase SQL Editor:

```sql
-- Run the CHECK_SMTP_ACCOUNTS.sql file
SELECT * FROM public.smtp_accounts;
```

### Step 2: Add SMTP Account (if none exist)

You have several options:

#### Option A: Use existing SQL scripts
Run one of these in Supabase:
- `QUICK_SMTP_SETUP.sql`
- `MINIMAL_SMTP_SETUP.sql`
- `SETUP_SMTP_SIMPLE.sql`

#### Option B: Add via UI
1. Go to your app's SMTP settings page
2. Click "Add SMTP Account"
3. Enter your email provider details:
   - **Gmail**: host=smtp.gmail.com, port=587
   - **Outlook**: host=smtp-mail.outlook.com, port=587
   - **Custom**: Your SMTP server details

#### Option C: Manual SQL Insert
```sql
INSERT INTO public.smtp_accounts (
  user_id,
  email,
  password,
  host,
  port,
  status,
  daily_limit,
  sent_today
) VALUES (
  'YOUR_USER_ID',
  'your-email@gmail.com',
  'your-app-password',
  'smtp.gmail.com',
  587,
  'active',
  500,
  0
);
```

### Step 3: Test Again
1. Restart your Next.js dev server
2. Go to bulk email generator
3. Generate some emails
4. Click "Test Send Email"
5. Enter your test email address

## Debugging

If it still doesn't work, check the browser console and server logs for:
- "Loaded X SMTP accounts" message
- "No active SMTP accounts found" warning
- Any error messages from nodemailer

## Common Issues

### Gmail App Passwords
If using Gmail, you need an App Password:
1. Enable 2FA on your Google account
2. Go to Google Account > Security > App Passwords
3. Generate a new app password
4. Use that password (not your regular password)

### Port Issues
- Port 587: TLS (recommended)
- Port 465: SSL
- Port 25: Usually blocked by ISPs

### Daily Limits
- Gmail: 500 emails/day per account
- Outlook: 300 emails/day
- Custom SMTP: Check with your provider
