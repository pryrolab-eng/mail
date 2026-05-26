# Follow-Up System Setup - Step by Step

## ⚠️ Important: Sign Up First!

Before running any setup scripts, you need to:
1. Start your app: `npm run dev`
2. Go to: http://localhost:3000/sign-up
3. Create an account
4. Then come back here and continue with the setup

---

## Quick Setup (3 Steps)

### Step 1: Run the Migration

Open your Supabase SQL Editor and run the migration file:

**File:** `supabase/migrations/20240606_email_tracking_replies.sql`

1. Go to Supabase Dashboard → SQL Editor
2. Click "New Query"
3. Copy the entire contents of `supabase/migrations/20240606_email_tracking_replies.sql`
4. Paste into the SQL Editor
5. Click "Run" or press `Ctrl+Enter`

**Expected Result:** You should see "Success. No rows returned"

---

### Step 2: Verify Tables Created

Run this verification query:

```sql
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
```

**Expected Result:** All tables should show `exists = true`

---

### Step 3: Create Automation Rules (After Sign Up)

**Important:** You must sign up first before running this step!

Run the simple setup script:

**File:** `SETUP_AUTOMATION_RULES_SIMPLE.sql`

1. First, sign up at http://localhost:3000/sign-up
2. Open Supabase SQL Editor
3. Copy and run STEP 1 and STEP 2 from `SETUP_AUTOMATION_RULES_SIMPLE.sql`
4. Copy your user_id from the results
5. Uncomment STEP 3 in the file (remove `/*` and `*/`)
6. Replace `'PASTE_YOUR_USER_ID_HERE'` with your actual UUID
7. Run STEP 3
8. Run STEP 4 to verify

**Expected Result:** You should see 6 automation rules created

**Alternative:** If you want to skip automation rules for now, just use the Follow-Up module without them. You can add rules later!

---

## Verification

### Check Everything is Working

Run this comprehensive check:

```sql
-- 1. Check tables exist
SELECT COUNT(*) as table_count
FROM information_schema.tables
WHERE table_name IN ('email_replies', 'ai_replies', 'email_inbox_config', 'email_automation_rules', 'crm_automation_log');
-- Should return: 5

-- 2. Check triggers exist
SELECT COUNT(*) as trigger_count
FROM information_schema.triggers
WHERE trigger_name IN ('trigger_auto_update_lead_on_reply', 'trigger_update_sent_email_on_reply');
-- Should return: 2

-- 3. Check automation rules created
SELECT COUNT(*) as rules_count
FROM email_automation_rules;
-- Should return: 6 (or more if you added custom rules)

-- 4. Get your user ID
SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 1;
-- Copy this ID for reference
```

---

## Troubleshooting

### Error: "relation does not exist"

**Problem:** Tables weren't created

**Solution:**
1. Make sure you ran the migration file completely
2. Check for any error messages in the SQL Editor
3. Verify you have admin permissions
4. Try running the migration again

---

### Error: "invalid input syntax for type uuid: YOUR_USER_ID"

**Problem:** You're trying to run a script with placeholder text

**Solution:**
- Don't run `AUTOMATION_RULES_EXAMPLES.sql` directly
- Use `SETUP_AUTOMATION_RULES_AUTO.sql` instead (it auto-detects your user ID)
- OR manually replace `YOUR_USER_ID` with your actual UUID from `auth.users`

---

### Error: "duplicate key value violates unique constraint"

**Problem:** Rules already exist

**Solution:**
This is fine! It means the rules were already created. You can:
1. Ignore this error
2. Or delete existing rules first:
   ```sql
   DELETE FROM email_automation_rules WHERE user_id = 'your-user-id';
   ```
   Then run the setup again

---

### Error: "permission denied"

**Problem:** Insufficient permissions

**Solution:**
1. Make sure you're logged in as the database owner
2. Check your Supabase project permissions
3. Try running from the Supabase Dashboard SQL Editor (not a local client)

---

## Manual Setup (Alternative)

If the automatic setup doesn't work, follow these manual steps:

### 1. Get Your User ID

```sql
SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 1;
```

Copy the `id` value (it's a UUID like `12345678-1234-1234-1234-123456789abc`)

### 2. Create Rules Manually

Replace `YOUR_USER_ID_HERE` with your actual UUID:

```sql
-- Rule 1: Mark as Interested on positive reply
INSERT INTO email_automation_rules (
  user_id, name, trigger_type, action_type, action_config, is_active, priority
) VALUES (
  'YOUR_USER_ID_HERE',
  'Mark as Interested on positive reply',
  'positive_reply',
  'update_crm_status',
  '{"new_status": "Interested"}'::jsonb,
  true,
  1
);

-- Rule 2: Mark as Dead on negative reply
INSERT INTO email_automation_rules (
  user_id, name, trigger_type, action_type, action_config, is_active, priority
) VALUES (
  'YOUR_USER_ID_HERE',
  'Mark as Dead on rejection',
  'negative_reply',
  'update_crm_status',
  '{"new_status": "Dead"}'::jsonb,
  true,
  1
);

-- Rule 3: Auto-reply to interested leads
INSERT INTO email_automation_rules (
  user_id, name, trigger_type, action_type, action_config, is_active, priority
) VALUES (
  'YOUR_USER_ID_HERE',
  'Auto-reply to interested leads',
  'positive_reply',
  'send_ai_reply',
  '{"tone": "professional", "auto_send": false}'::jsonb,
  true,
  2
);
```

---

## Next Steps

After setup is complete:

1. ✅ **Test the Follow-Up Module**
   - Navigate to Dashboard → Follow-Up
   - Click "Check for Replies" (will simulate in demo mode)
   - Verify the UI loads correctly

2. ✅ **Send Test Emails**
   - Go to Email Writer or CRM
   - Send a few test emails
   - Verify they appear in Follow-Up → Sent Emails

3. ✅ **Test AI Response Generation**
   - Simulate a reply (click "Check for Replies")
   - Click "Generate AI Response"
   - Verify AI generates a response

4. ✅ **Check CRM Automation**
   - After simulating a reply, check the CRM
   - Verify lead status changed to "Replied"
   - Check automation log:
     ```sql
     SELECT * FROM crm_automation_log ORDER BY executed_at DESC LIMIT 10;
     ```

5. ✅ **Configure Real Email Inbox** (Optional)
   - Set up Gmail API or IMAP
   - See `FOLLOW_UP_SYSTEM_GUIDE.md` for details

---

## Files Reference

- **Migration:** `supabase/migrations/20240606_email_tracking_replies.sql`
- **Auto Setup:** `SETUP_AUTOMATION_RULES_AUTO.sql`
- **Get User ID:** `GET_YOUR_USER_ID.sql`
- **Manual Examples:** `AUTOMATION_RULES_EXAMPLES.sql` (reference only)
- **Full Guide:** `FOLLOW_UP_SYSTEM_GUIDE.md`
- **UI Guide:** `FOLLOW_UP_UI_GUIDE.md`
- **Quick Start:** `FOLLOW_UP_QUICK_START.md`

---

## Success Checklist

- [ ] Migration ran successfully
- [ ] 5 tables created (email_replies, ai_replies, email_inbox_config, email_automation_rules, crm_automation_log)
- [ ] 2 triggers created (trigger_auto_update_lead_on_reply, trigger_update_sent_email_on_reply)
- [ ] 6 automation rules created
- [ ] Follow-Up module loads without errors
- [ ] Can view Sent Emails tab
- [ ] Can simulate reply detection
- [ ] Can generate AI response
- [ ] CRM updates automatically

---

## Need Help?

If you're still having issues:

1. Check the error message carefully
2. Look in the Troubleshooting section above
3. Run the verification queries
4. Check Supabase logs (Dashboard → Logs)
5. Share the error message for specific help

**Common Issues:**
- ❌ "YOUR_USER_ID" error → Use `SETUP_AUTOMATION_RULES_AUTO.sql` instead
- ❌ Tables don't exist → Run the migration file first
- ❌ Permission denied → Use Supabase Dashboard SQL Editor
- ❌ Duplicate key error → Rules already exist (this is fine!)
