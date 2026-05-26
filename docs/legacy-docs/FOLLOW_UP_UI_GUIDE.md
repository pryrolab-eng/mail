# Follow-Up Module UI Guide

## Overview
The Follow-Up Module provides a comprehensive interface for managing email replies, generating AI responses, and automating CRM updates.

## Navigation

### Main Tabs

1. **Sent Emails** - View all emails you've sent
2. **Replies** - View incoming replies with sentiment analysis
3. **AI Responses** - Manage AI-generated responses

## Features by Tab

### 1. Sent Emails Tab

**What You See:**
- List of all sent emails
- Lead company name
- Email subject
- Status badges (Sent, Opened, Replied, Bounced)
- Timestamp
- Reply indicator

**Status Indicators:**
- 🔵 **SENT** - Email delivered successfully
- 🟡 **OPENED** - Recipient opened the email
- 🟢 **REPLIED** - Recipient replied
- 🔴 **BOUNCED** - Email failed to deliver

**Actions:**
- Click on any email to view details
- Filter by status
- Sort by date

---

### 2. Replies Tab

**What You See:**
- All incoming replies to your emails
- Lead company name and email
- Reply subject and body
- Sentiment indicators
- AI response status

**Sentiment Indicators:**
- 👍 **INTERESTED** (Green) - Positive reply, lead is interested
- 👎 **NOT_INTERESTED** (Red) - Negative reply, lead declined
- ⚪ **NEUTRAL** (Gray) - Neutral response

**Actions:**

#### Generate AI Response
1. Click **"Generate AI Response"** button on any reply
2. Wait for AI to analyze the reply and generate a response
3. Review the generated response in the modal
4. Edit if needed
5. Click **"Send Reply"** or **"Close"**

**What Happens:**
- AI analyzes the reply context
- Considers lead information (company, niche, location)
- Generates personalized response
- Saves as draft in AI Responses tab
- Updates reply status

---

### 3. AI Responses Tab

**What You See:**
- All AI-generated responses
- Original reply context
- Generated response
- Status (Draft, Approved, Sent, Rejected)

**Status Indicators:**
- 📝 **DRAFT** (Gray) - Response generated, awaiting review
- ✅ **APPROVED** (Blue) - Response approved, ready to send
- 📤 **SENT** (Green) - Response sent successfully
- ❌ **REJECTED** (Red) - Response rejected, won't be sent

**Actions:**

#### For Draft Responses:
1. **Send Reply** - Send the AI response immediately
2. **Reject** - Mark as rejected (won't be sent)

#### For Sent Responses:
- View sent timestamp
- See delivery status
- Track conversation thread

---

## Top Bar Features

### Stats Dashboard
Monitor your email performance at a glance:

1. **Emails Sent** (Blue) - Total emails sent
2. **Replies Received** (Green) - Total replies received
3. **Positive Replies** (Orange) - Replies with positive sentiment
4. **AI Responses** (Purple) - AI responses generated
5. **AI Sent** (Pink) - AI responses actually sent

### Check for Replies Button
Click **"Check for Replies"** to:
- Scan your inbox for new replies
- Match replies to sent emails
- Analyze sentiment automatically
- Update CRM statuses
- Trigger automation rules

**Note:** In production, this connects to your email inbox via IMAP or Gmail API. In demo mode, it simulates finding a reply.

---

## Workflow Examples

### Example 1: Responding to an Interested Lead

1. **Check for Replies**
   - Click "Check for Replies" button
   - New replies appear in Replies tab

2. **Review Reply**
   - Navigate to Replies tab
   - See reply with 👍 INTERESTED sentiment
   - Read the reply content

3. **Generate AI Response**
   - Click "Generate AI Response"
   - Wait for AI to generate response
   - Review in modal

4. **Send Response**
   - Click "Send Reply" in modal
   - Response is sent via SMTP
   - Lead status updated to "Interested"
   - Reply marked as "AI response sent"

5. **Track in AI Responses**
   - Navigate to AI Responses tab
   - See sent response with timestamp
   - Monitor conversation thread

---

### Example 2: Handling a Negative Reply

1. **Reply Detected**
   - Reply appears with 👎 NOT_INTERESTED sentiment
   - CRM automatically updates lead to "Dead"

2. **Review (Optional)**
   - Read the reply to understand why
   - Check automation log for status change

3. **No Action Needed**
   - System already updated CRM
   - Lead marked as "Dead"
   - No follow-up will be sent

---

### Example 3: Bulk Reply Management

1. **Check Multiple Replies**
   - Click "Check for Replies"
   - Multiple new replies detected

2. **Filter by Sentiment**
   - Focus on positive replies first
   - Generate AI responses for interested leads

3. **Batch Process**
   - Generate AI responses for all positive replies
   - Review each in AI Responses tab
   - Send approved responses
   - Reject or edit others

---

## Automation Features

### Automatic CRM Updates

**When a reply is received:**
- Lead status changes from "Email Sent" to "Replied"
- Timestamp recorded
- Automation log entry created

**When sentiment is positive:**
- Lead status can change to "Interested"
- Follow-up task created (if configured)
- Notification sent (if configured)

**When sentiment is negative:**
- Lead status can change to "Dead"
- No further follow-ups sent
- Unsubscribe processed (if requested)

### Automation Rules

You can create custom rules in the database:

**Trigger Types:**
- `reply_received` - Any reply
- `positive_reply` - Positive sentiment
- `negative_reply` - Negative sentiment
- `no_reply_after_days` - No reply after X days

**Action Types:**
- `send_ai_reply` - Generate and send AI response
- `update_crm_status` - Change lead status
- `create_task` - Create follow-up task
- `send_notification` - Notify team

See `AUTOMATION_RULES_EXAMPLES.sql` for examples.

---

## Tips & Best Practices

### 1. Check Replies Regularly
- Set up a schedule (every 15-30 minutes)
- Don't miss time-sensitive replies
- Respond quickly to interested leads

### 2. Review AI Responses
- Always review before sending
- Edit for personalization
- Ensure accuracy and tone

### 3. Monitor Sentiment
- Focus on positive replies first
- Respond quickly to interested leads
- Don't waste time on negative replies

### 4. Track Performance
- Monitor reply rates
- Track positive vs negative sentiment
- Measure AI response effectiveness
- Adjust strategy based on data

### 5. Customize Automation
- Set up rules for your workflow
- Adjust based on results
- Test different approaches
- Monitor automation log

---

## Keyboard Shortcuts (Future)

- `R` - Check for replies
- `G` - Generate AI response for selected reply
- `S` - Send selected AI response
- `Tab` - Switch between tabs
- `Esc` - Close modal

---

## Troubleshooting

### No Replies Showing
- Check email inbox configuration
- Verify IMAP/Gmail API credentials
- Check spam folder
- Ensure emails were actually sent

### AI Response Not Generating
- Check AI provider configuration
- Verify API key is active
- Check rate limits
- Review error logs

### CRM Not Updating
- Check automation triggers are enabled
- Verify database permissions
- Review automation log
- Check lead status manually

### Email Not Sending
- Check SMTP configuration
- Verify SMTP accounts are active
- Check rate limits
- Review send logs

---

## Mobile Responsiveness

The Follow-Up Module is fully responsive:

- **Desktop**: Full 3-column layout with all features
- **Tablet**: 2-column layout with collapsible sidebar
- **Mobile**: Single column with tab navigation

---

## Future Enhancements

Coming soon:
- ✨ Bulk actions (select multiple replies)
- 📊 Analytics dashboard
- 🔔 Real-time notifications
- 📅 Schedule AI responses
- 🎯 A/B testing for responses
- 👥 Team collaboration
- 🔗 CRM integrations (Salesforce, HubSpot)
- 📱 Mobile app

---

## Support

Need help?
1. Check this guide
2. Review `FOLLOW_UP_SYSTEM_GUIDE.md`
3. Check automation logs
4. Contact support with screenshots
