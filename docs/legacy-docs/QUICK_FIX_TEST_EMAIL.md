# Quick Fix: Test Email Not Working

## Error Found
```
Error loading SMTP accounts: {
  code: 'PGRST205',
  message: "Could not find the table 'public.smtp_accounts' in the schema cache"
}
```

## The Problem
The `smtp_accounts` table doesn't exist in your Supabase database.

## Quick Fix (3 Steps)

### Step 1: Create the Table
1. Go to your Supabase project: https://qjsnwefgzmmpsuzjfniu.supabase.co
2. Click on "SQL Editor" in the left sidebar
3. Copy and paste the entire contents of `CREATE_SMTP_TABLE_NOW.sql`
4. Click "Run" or press Ctrl+Enter
5. You should see a success message

### Step 2: Add Your SMTP Account
1. Still in SQL Editor, open `ADD_SMTP_ACCOUNT_NOW.sql`
2. **IMPORTANT**: Get a Gmail App Password first:
   - Go to https://myaccount.google.com/security
   - Enable 2-Step Verification
   - Go to https://myaccount.google.com/apppasswords
   - Create app password for "Mail"
   - Copy the 16-character password

3. Edit the INSERT statement in `ADD_SMTP_ACCOUNT_NOW.sql`:
   ```sql
   INSERT INTO public.smtp_accounts (
     user_id,
     email,
     host,
     port,
     user_name,
     password,
     provider,
     daily_limit,
     sent_today,
     status
   ) VALUES (
     'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae',  -- Already correct
     'your-email@gmail.com',                   -- Change this
     'smtp.gmail.com',                         -- Keep as is
     587,                                      -- Keep as is
     'your-email@gmail.com',                   -- Change this (same as email)
     'abcd efgh ijkl mnop',                    -- Your 16-char app password
     'gmail',                                  -- Keep as is
     500,                                      -- Keep as is
     0,                                        -- Keep as is
     'active'                                  -- Keep as is
   );
   ```

4. Run the INSERT statement
5. Run the SELECT statement to verify

### Step 3: Test Again
1. Restart your Next.js dev server (Ctrl+C, then run again)
2. Refresh your browser at http://localhost:3000/dashboard
3. Go to Email Writer
4. Generate some emails
5. Click "Send Test" button
6. Enter your test email address
7. Check your inbox!

## Troubleshooting

### "Authentication failed" error
- You're using your regular Gmail password instead of App Password
- Solution: Get an App Password from Google (see Step 2)

### "Connection timeout" error
- Port might be blocked by firewall
- Try port 465 instead of 587 (change `secure: true` in code)

### Still not working?
Run this in Supabase SQL Editor to check:
```sql
SELECT * FROM smtp_accounts WHERE user_id = 'eadd4fd6-f30e-49bb-99a8-7acedd1bf9ae';
```

You should see your SMTP account with status = 'active'.

## Alternative: Use Existing Scripts

If you prefer, you can also use:
- `QUICK_SMTP_SETUP.sql` - Automated setup
- `MINIMAL_SMTP_SETUP.sql` - Minimal setup

But the steps above are the fastest way to fix the issue.
