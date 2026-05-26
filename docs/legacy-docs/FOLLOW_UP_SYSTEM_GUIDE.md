# Email Follow-Up & Reply Management System

## Overview

This comprehensive follow-up system tracks sent emails, detects replies, generates AI-powered responses, and automates CRM updates. It provides a complete workflow for managing email conversations at scale.

## Features

### 1. **Email Tracking**
- Track all sent emails with status (sent, opened, replied, bounced)
- Store email metadata (subject, body, timestamps)
- Link emails to leads and campaigns
- Thread tracking with Message-ID and In-Reply-To headers

### 2. **Reply Detection**
- Automatic reply detection via IMAP/Gmail API integration
- Match replies to original sent emails
- Extract reply content and metadata
- Real-time notifications for new replies

### 3. **Sentiment Analysis**
- Automatic sentiment detection (positive, neutral, negative, interested, not_interested)
- Keyword-based analysis with AI enhancement
- Confidence scoring
- Visual indicators for reply sentiment

### 4. **AI-Powered Response Generation**
- Generate personalized responses using AI (GPT-4, Claude, etc.)
- Context-aware replies based on:
  - Original email content
  - Lead information (company, niche, location)
  - Reply sentiment
  - Conversation history
- Customizable tone (professional, casual, friendly)
- Draft, review, and approve workflow

### 5. **Automated CRM Updates**
- Automatic lead status updates on reply
- Trigger-based automation rules
- Status transitions:
  - "Email Sent" → "Replied" (on any reply)
  - "Replied" → "Interested" (on positive reply)
  - "Replied" → "Not Interested" (on negative reply)
- Automation logging and audit trail

### 6. **Email Automation Rules**
- Create custom automation rules with triggers:
  - `reply_received` - Any reply detected
  - `positive_reply` - Positive sentiment reply
  - `negative_reply` - Negative sentiment reply
  - `no_reply_after_days` - No reply after X days
- Actions:
  - `send_ai_reply` - Auto-generate and send AI response
  - `update_crm_status` - Change lead status
  - `create_task` - Create follow-up task
  - `send_notification` - Notify team member

## Database Schema

### Tables Created

#### `email_replies`
Stores all incoming replies to sent emails.

```sql
- id: UUID (primary key)
- user_id: UUID (references auth.users)
- sent_email_id: UUID (references sent_emails)
- lead_id: UUID (references leads)
- from_email: TEXT
- subject: TEXT
- body: TEXT
- received_at: TIMESTAMPTZ
- is_positive: BOOLEAN
- sentiment: TEXT (positive, neutral, negative, interested, not_interested)
- ai_response_generated: BOOLEAN
- ai_response_sent: BOOLEAN
- created_at: TIMESTAMPTZ
```

#### `ai_replies`
Stores AI-generated responses to replies.

```sql
- id: UUID (primary key)
- user_id: UUID (references auth.users)
- reply_id: UUID (references email_replies)
- lead_id: UUID (references leads)
- subject: TEXT
- body: TEXT
- tone: TEXT
- model_used: TEXT
- sent_at: TIMESTAMPTZ
- status: TEXT (draft, approved, sent, rejected)
- created_at: TIMESTAMPTZ
```

#### `email_inbox_config`
Configuration for email inbox monitoring (IMAP/Gmail API).

```sql
- id: UUID (primary key)
- user_id: UUID (references auth.users)
- email_address: TEXT
- provider: TEXT (gmail, outlook, imap)
- access_token: TEXT (for OAuth)
- refresh_token: TEXT (for OAuth)
- imap_host: TEXT
- imap_port: INTEGER
- imap_username: TEXT
- imap_password: TEXT
- last_checked_at: TIMESTAMPTZ
- is_active: BOOLEAN
- auto_reply_enabled: BOOLEAN
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

#### `email_automation_rules`
Custom automation rules for email workflows.

```sql
- id: UUID (primary key)
- user_id: UUID (references auth.users)
- name: TEXT
- trigger_type: TEXT (reply_received, positive_reply, negative_reply, no_reply_after_days)
- trigger_condition: JSONB
- action_type: TEXT (send_ai_reply, update_crm_status, create_task, send_notification)
- action_config: JSONB
- is_active: BOOLEAN
- priority: INTEGER
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ
```

#### `crm_automation_log`
Audit log for all automated CRM actions.

```sql
- id: UUID (primary key)
- user_id: UUID (references auth.users)
- lead_id: UUID (references leads)
- rule_id: UUID (references email_automation_rules)
- action_type: TEXT
- old_status: TEXT
- new_status: TEXT
- details: JSONB
- executed_at: TIMESTAMPTZ
```

## Automatic Triggers

### 1. Auto-Update Lead Status on Reply
When a reply is received, the lead status is automatically updated to "Replied".

```sql
CREATE TRIGGER trigger_auto_update_lead_on_reply
  AFTER INSERT ON email_replies
  FOR EACH ROW
  EXECUTE FUNCTION auto_update_lead_status_on_reply();
```

### 2. Update Sent Email on Reply
When a reply is received, the original sent email is marked as "replied".

```sql
CREATE TRIGGER trigger_update_sent_email_on_reply
  AFTER INSERT ON email_replies
  FOR EACH ROW
  EXECUTE FUNCTION update_sent_email_on_reply();
```

## Server Actions

### `checkEmailRepliesAction(userId: string)`
Check for new email replies via IMAP/Gmail API.

**Returns:**
```typescript
{
  success: boolean;
  replies: EmailReply[];
  newReplies: number;
}
```

### `generateAIReplyAction(userId: string, replyId: string, options?)`
Generate an AI-powered response to a reply.

**Options:**
- `tone?: string` - Response tone (professional, casual, friendly)
- `includeContext?: boolean` - Include full conversation context

**Returns:**
```typescript
{
  success: boolean;
  aiReply: AIReply;
  response: { subject: string; body: string };
}
```

### `sendAIReplyAction(userId: string, aiReplyId: string)`
Send an approved AI-generated reply.

**Returns:**
```typescript
{
  success: boolean;
  message: string;
}
```

### `updateLeadStatusFromReplyAction(userId: string, leadId: string, newStatus: string)`
Manually update lead status from the follow-up module.

**Returns:**
```typescript
{
  success: boolean;
  message: string;
}
```

### `analyzeSentimentAction(text: string)`
Analyze sentiment of reply text.

**Returns:**
```typescript
{
  success: boolean;
  sentiment: string;
  isPositive: boolean;
  confidence: number;
}
```

## Usage Workflow

### 1. Send Initial Emails
Use the Email Writer or Bulk Email Sender to send initial outreach emails. These are tracked in the `sent_emails` table.

### 2. Check for Replies
Click "Check for Replies" in the Follow-Up module to scan your inbox for new replies. The system will:
- Connect to your email inbox (IMAP/Gmail API)
- Find replies to your sent emails
- Extract reply content and metadata
- Analyze sentiment automatically
- Store in `email_replies` table
- Trigger automatic CRM updates

### 3. Review Replies
Navigate to the "Replies" tab to see all incoming replies with:
- Lead information
- Reply content
- Sentiment indicators (positive/negative)
- Timestamp

### 4. Generate AI Response
For each reply, click "Generate AI Response" to:
- Analyze the reply context
- Generate a personalized response using AI
- Preview the response before sending
- Edit if needed

### 5. Send AI Response
Review the AI-generated response and click "Send Reply" to:
- Send the email via SMTP
- Update the reply as "AI response sent"
- Update lead status if needed
- Log the interaction

### 6. Monitor AI Responses
Navigate to the "AI Responses" tab to see all AI-generated responses with their status (draft, sent, rejected).

## Integration with Gmail API

To enable automatic reply detection with Gmail:

### 1. Set up Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable Gmail API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs

### 2. Configure OAuth Flow
```typescript
// Example OAuth configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

// Get authorization URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.readonly'],
});
```

### 3. Store Tokens
Save access and refresh tokens in `email_inbox_config` table.

### 4. Check for Replies
```typescript
// Example Gmail API usage
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

const response = await gmail.users.messages.list({
  userId: 'me',
  q: 'is:unread in:inbox',
});

// Process messages and match to sent emails
```

## Integration with IMAP

For non-Gmail providers, use IMAP:

### 1. Configure IMAP Settings
Store IMAP credentials in `email_inbox_config`:
- `imap_host`: e.g., "imap.gmail.com"
- `imap_port`: e.g., 993
- `imap_username`: Your email
- `imap_password`: App-specific password

### 2. Connect and Fetch
```typescript
import Imap from 'imap';

const imap = new Imap({
  user: config.imap_username,
  password: config.imap_password,
  host: config.imap_host,
  port: config.imap_port,
  tls: true,
});

// Fetch unread messages
imap.connect();
imap.openBox('INBOX', false, (err, box) => {
  // Search for unread messages
  imap.search(['UNSEEN'], (err, results) => {
    // Process messages
  });
});
```

## Automation Rules Examples

### Example 1: Auto-Reply to Positive Responses
```sql
INSERT INTO email_automation_rules (
  user_id,
  name,
  trigger_type,
  trigger_condition,
  action_type,
  action_config,
  is_active
) VALUES (
  'user-uuid',
  'Auto-reply to interested leads',
  'positive_reply',
  '{"min_confidence": 0.7}',
  'send_ai_reply',
  '{"tone": "professional", "auto_send": true}',
  true
);
```

### Example 2: Update Status on Negative Reply
```sql
INSERT INTO email_automation_rules (
  user_id,
  name,
  trigger_type,
  action_type,
  action_config,
  is_active
) VALUES (
  'user-uuid',
  'Mark as Dead on rejection',
  'negative_reply',
  'update_crm_status',
  '{"new_status": "Dead"}',
  true
);
```

### Example 3: Follow-up After No Reply
```sql
INSERT INTO email_automation_rules (
  user_id,
  name,
  trigger_type,
  trigger_condition,
  action_type,
  action_config,
  is_active
) VALUES (
  'user-uuid',
  'Follow-up after 3 days',
  'no_reply_after_days',
  '{"days": 3}',
  'send_ai_reply',
  '{"tone": "casual", "template": "follow_up_1"}',
  true
);
```

## Best Practices

### 1. Reply Detection
- Check for replies regularly (every 5-15 minutes)
- Use Message-ID headers to match replies accurately
- Handle threading correctly with In-Reply-To headers

### 2. AI Response Generation
- Always review AI responses before sending
- Customize tone based on lead sentiment
- Include relevant context from previous emails
- Keep responses concise (under 200 words)

### 3. CRM Automation
- Set up clear status transition rules
- Log all automated actions for audit trail
- Allow manual overrides when needed
- Monitor automation effectiveness

### 4. Email Deliverability
- Rotate SMTP accounts to avoid rate limits
- Add delays between emails (2-5 seconds)
- Monitor bounce rates and adjust
- Use proper email headers (Reply-To, In-Reply-To)

### 5. Privacy & Security
- Encrypt stored credentials (OAuth tokens, IMAP passwords)
- Use environment variables for sensitive data
- Implement proper access controls
- Comply with email privacy regulations (GDPR, CAN-SPAM)

## Monitoring & Analytics

Track these metrics in your dashboard:
- **Reply Rate**: % of sent emails that received replies
- **Positive Reply Rate**: % of replies with positive sentiment
- **AI Response Rate**: % of replies that got AI responses
- **Conversion Rate**: % of replies that became interested leads
- **Response Time**: Average time to respond to replies
- **Automation Success Rate**: % of successful automated actions

## Troubleshooting

### Issue: Replies Not Detected
- Check IMAP/Gmail API credentials
- Verify `last_checked_at` timestamp
- Check email filters/spam folders
- Verify Message-ID matching logic

### Issue: AI Responses Not Generating
- Check AI provider API key
- Verify active model configuration
- Check API rate limits
- Review error logs

### Issue: CRM Not Updating
- Check trigger functions are enabled
- Verify lead_id references are correct
- Review automation log for errors
- Check database permissions

## Future Enhancements

1. **Multi-channel Support**: SMS, LinkedIn, WhatsApp
2. **Advanced AI**: Fine-tuned models for your industry
3. **A/B Testing**: Test different response templates
4. **Scheduling**: Schedule AI responses for optimal times
5. **Team Collaboration**: Assign replies to team members
6. **Analytics Dashboard**: Detailed performance metrics
7. **Webhook Integration**: Connect to external CRMs (Salesforce, HubSpot)
8. **Voice Integration**: Transcribe and respond to voice messages

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review database logs
3. Check server action responses
4. Contact support with error details
