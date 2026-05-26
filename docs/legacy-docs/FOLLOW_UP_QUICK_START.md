# Follow-Up System Quick Start Checklist

## ✅ Setup Checklist

### 1. Database Setup
- [ ] Run migration: `supabase/migrations/20240606_email_tracking_replies.sql`
- [ ] Verify tables created: `email_replies`, `ai_replies`, `email_inbox_config`, `email_automation_rules`, `crm_automation_log`
- [ ] Check triggers are active: `trigger_auto_update_lead_on_reply`, `trigger_update_sent_email_on_reply`

**Quick Test:**
```sql
-- Run in Supabase SQL Editor
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('email_replies', 'ai_replies', 'email_inbox_config', 'email_automation_rules', 'crm_automation_log');
```

---

### 2. Email Inbox Configuration (Optional but Recommended)

#### Option A: Gmail API (Recommended)
- [ ] Create Google Cloud Project
- [ ] Enable Gmail API
- [ ] Create OAuth 2.0 credentials
- [ ] Add redirect URIs
- [ ] Store credentials in `.env.local`:
  ```
  GMAIL_CLIENT_ID=your_client_id
  GMAIL_CLIENT_SECRET=your_client_secret
  GMAIL_REDIRECT_URI=http://localhost:3000/auth/gmail/callback
  ```

#### Option B: IMAP (Alternative)
- [ ] Get IMAP settings from your email provider
- [ ] Create app-specific password (if using Gmail)
- [ ] Store in `email_inbox_config` table:
  ```sql
  INSERT INTO email_inbox_config (
    user_id,
    email_address,
    provider,
    imap_host,
    imap_port,
    imap_username,
    imap_password,
    is_active
  ) VALUES (
    'YOUR_USER_ID',
    'your-email@gmail.com',
    'gmail',
    'imap.gmail.com',
    993,
    'your-email@gmail.com',
    'your-app-password',
    true
  );
  ```

---

### 3. AI Provider Configuration
- [ ] Configure AI provider in dashboard (Settings → AI Settings)
- [ ] Add API key for OpenAI, Anthropic, or other provider
- [ ] Select active model (e.g., gpt-4, claude-3-opus)
- [ ] Test AI generation

**Verify:**
```sql
SELECT provider, active_model, is_active 
FROM ai_providers 
WHERE user_id = 'YOUR_USER_ID';
```

---

### 4. SMTP Configuration
- [ ] Configure SMTP accounts (SMTP Manager)
- [ ] Add at least 1 Gmail account (up to 60 recommended)
- [ ] Test email sending
- [ ] Verify rotation is working

---

### 5. Automation Rules (Optional)
- [ ] Review `AUTOMATION_RULES_EXAMPLES.sql`
- [ ] Create rules for your workflow
- [ ] Test each rule
- [ ] Monitor automation log

**Quick Setup - Essential Rules:**
```sql
-- Replace YOUR_USER_ID with your actual user ID

-- Rule 1: Update status on any reply
INSERT INTO email_automation_rules (user_id, name, trigger_type, action_type, action_config, is_active)
VALUES ('YOUR_USER_ID', 'Update status on reply', 'reply_received', 'update_crm_status', '{"new_status": "Replied"}'::jsonb, true);

-- Rule 2: Mark interested on positive reply
INSERT INTO email_automation_rules (user_id, name, trigger_type, action_type, action_config, is_active)
VALUES ('YOUR_USER_ID', 'Mark interested', 'positive_reply', 'update_crm_status', '{"new_status": "Interested"}'::jsonb, true);

-- Rule 3: Mark dead on negative reply
INSERT INTO email_automation_rules (user_id, name, trigger_type, action_type, action_config, is_active)
VALUES ('YOUR_USER_ID', 'Mark dead', 'negative_reply', 'update_crm_status', '{"new_status": "Dead"}'::jsonb, true);
```

---

## 🚀 First Use Workflow

### Step 1: Send Initial Emails
1. Go to **Email Writer** or **CRM** module
2. Select leads
3. Generate and send emails
4. Verify emails appear in **Follow-Up → Sent Emails** tab

### Step 2: Simulate a Reply (Testing)
1. Go to **Follow-Up** module
2. Click **"Check for Replies"** button
3. System will simulate finding a reply (demo mode)
4. Reply appears in **Replies** tab

### Step 3: Generate AI Response
1. Navigate to **Replies** tab
2. Find the new reply
3. Click **"Generate AI Response"**
4. Wait for AI to generate response
5. Review in modal

### Step 4: Send AI Response
1. Review the AI-generated response
2. Edit if needed (future feature)
3. Click **"Send Reply"**
4. Verify in **AI Responses** tab

### Step 5: Check CRM Update
1. Go to **CRM** module
2. Find the lead
3. Verify status changed to "Replied" or "Interested"
4. Check automation log:
   ```sql
   SELECT * FROM crm_automation_log 
   WHERE user_id = 'YOUR_USER_ID' 
   ORDER BY executed_at DESC 
   LIMIT 10;
   ```

---

## 📊 Monitoring & Verification

### Check Stats
Navigate to Follow-Up module and verify:
- ✅ Emails Sent count is correct
- ✅ Replies Received count updates
- ✅ Positive Replies count shows sentiment analysis
- ✅ AI Responses count increases
- ✅ AI Sent count tracks sent responses

### Check Database
```sql
-- Verify sent emails
SELECT COUNT(*) as sent_count FROM sent_emails WHERE user_id = 'YOUR_USER_ID';

-- Verify replies
SELECT COUNT(*) as reply_count FROM email_replies WHERE user_id = 'YOUR_USER_ID';

-- Verify AI responses
SELECT COUNT(*) as ai_count FROM ai_replies WHERE user_id = 'YOUR_USER_ID';

-- Check automation log
SELECT 
  action_type,
  COUNT(*) as count
FROM crm_automation_log 
WHERE user_id = 'YOUR_USER_ID'
GROUP BY action_type;
```

---

## 🔧 Troubleshooting

### Issue: Migration Failed
**Solution:**
1. Check Supabase logs
2. Verify you have admin permissions
3. Run migration manually in SQL Editor
4. Check for conflicting table names

### Issue: No Replies Detected
**Solution:**
1. Verify email inbox configuration
2. Check IMAP/Gmail API credentials
3. Test connection manually
4. Check `last_checked_at` timestamp

### Issue: AI Response Not Generating
**Solution:**
1. Check AI provider configuration
2. Verify API key is valid
3. Check rate limits
4. Review browser console for errors

### Issue: CRM Not Updating
**Solution:**
1. Check triggers are enabled:
   ```sql
   SELECT * FROM pg_trigger 
   WHERE tgname IN ('trigger_auto_update_lead_on_reply', 'trigger_update_sent_email_on_reply');
   ```
2. Verify lead_id references are correct
3. Check automation log for errors
4. Test trigger manually

### Issue: Email Not Sending
**Solution:**
1. Check SMTP configuration
2. Verify SMTP accounts are active
3. Check rate limits (60 emails/day per Gmail account)
4. Review send logs in browser console

---

## 📚 Documentation Reference

- **Full System Guide**: `FOLLOW_UP_SYSTEM_GUIDE.md`
- **UI Guide**: `FOLLOW_UP_UI_GUIDE.md`
- **Automation Examples**: `AUTOMATION_RULES_EXAMPLES.sql`
- **Setup Script**: `SETUP_FOLLOW_UP_TRACKING.sql`

---

## 🎯 Success Criteria

You're ready to go when:
- ✅ All database tables created
- ✅ Triggers are active
- ✅ AI provider configured
- ✅ SMTP accounts configured
- ✅ Can send test email
- ✅ Can simulate reply detection
- ✅ Can generate AI response
- ✅ Can send AI response
- ✅ CRM updates automatically
- ✅ Stats dashboard shows correct numbers

---

## 🚀 Next Steps

1. **Send Real Emails**: Use Email Writer or Bulk Sender
2. **Configure Real Inbox**: Set up Gmail API or IMAP
3. **Create Automation Rules**: Customize for your workflow
4. **Monitor Performance**: Track reply rates and conversions
5. **Scale Up**: Add more SMTP accounts, refine AI prompts

---

## 💡 Pro Tips

1. **Start Small**: Test with 5-10 emails first
2. **Review AI Responses**: Always review before sending
3. **Monitor Sentiment**: Focus on positive replies
4. **Adjust Automation**: Refine rules based on results
5. **Track Metrics**: Monitor reply rates and conversions
6. **Rotate SMTP**: Use multiple accounts to avoid limits
7. **Respond Quickly**: Set up frequent reply checks
8. **Personalize**: Customize AI responses for your industry

---

## 🆘 Need Help?

1. Check troubleshooting section above
2. Review full documentation
3. Check Supabase logs
4. Check browser console
5. Review automation log
6. Contact support with:
   - Error messages
   - Screenshots
   - Steps to reproduce
   - Database query results

---

## ✨ What's Next?

After setup, explore:
- **Bulk Email Campaigns**: Send to 100+ leads at once
- **Follow-Up Sequences**: Automated multi-step campaigns
- **A/B Testing**: Test different email templates
- **Analytics**: Track performance metrics
- **Team Collaboration**: Assign replies to team members
- **CRM Integration**: Connect to Salesforce, HubSpot, etc.

---

**Ready to start? Run the migration and follow the First Use Workflow above!** 🚀
