# SMTP Multi-Account Email System Setup Guide

## Overview
This system allows you to send 6,000+ personalized emails per day using 60 SMTP accounts (100 emails per account per day).

## Features
✅ Multi-SMTP account management with automatic rotation
✅ AI-powered personalized email generation
✅ Smart rate limiting and daily quota tracking
✅ Email queue system for handling capacity overflow
✅ Campaign tracking and analytics
✅ Automatic retry for failed emails

## Setup Instructions

### 1. Install Dependencies
```bash
npm install nodemailer @types/nodemailer
```

### 2. Run Database Migration
```bash
# Navigate to your Supabase project
cd supabase
supabase db push
```

Or manually run the migration file: `supabase/migrations/20240602_smtp_accounts.sql`

### 3. Configure SMTP Accounts

#### Option A: Gmail (Recommended for testing)
1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" and your device
   - Copy the 16-character password
3. Use these settings:
   - Host: `smtp.gmail.com`
   - Port: `587`
   - Email: your Gmail address
   - Password: the app password (not your regular password)
   - Daily Limit: `100`

#### Option B: Outlook/Hotmail
- Host: `smtp-mail.outlook.com`
- Port: `587`
- Daily Limit: `100`

#### Option C: SendGrid (Best for high volume)
1. Sign up at https://sendgrid.com
2. Create an API key
3. Settings:
   - Host: `smtp.sendgrid.net`
   - Port: `587`
   - Username: `apikey`
   - Password: Your SendGrid API key
   - Daily Limit: `100` (or your plan limit)

#### Option D: Mailgun
1. Sign up at https://mailgun.com
2. Get SMTP credentials from dashboard
3. Settings:
   - Host: `smtp.mailgun.org`
   - Port: `587`
   - Daily Limit: `100`

#### Option E: SMTP2GO
- Host: `mail.smtp2go.com`
- Port: `2525` or `587`
- Daily Limit: `100`

### 4. Add SMTP Accounts to Your System

Navigate to the SMTP Manager in your platform and add accounts using the form. For 60 accounts:

**Strategy 1: Multiple Gmail Accounts (Free)**
- Create 60 Gmail accounts
- Enable app passwords for each
- Add all 60 to the system
- Total capacity: 6,000 emails/day

**Strategy 2: Mix of Providers (Recommended)**
- 20 Gmail accounts (2,000 emails/day)
- 20 Outlook accounts (2,000 emails/day)
- 10 SendGrid accounts (1,000 emails/day)
- 10 Mailgun accounts (1,000 emails/day)
- Total capacity: 6,000 emails/day

**Strategy 3: Professional (Best deliverability)**
- Use dedicated SMTP services like SendGrid, Mailgun, or Amazon SES
- Configure custom domains for better deliverability
- Set up SPF, DKIM, and DMARC records

### 5. Environment Variables (Optional)

Add to `.env.local` for API-based scraping:

```env
# Google APIs for lead scraping
GOOGLE_API_KEY=your_google_api_key
GOOGLE_CX=your_custom_search_engine_id
GOOGLE_PLACES_API_KEY=your_places_api_key

# Alternative scraping APIs
RAPIDAPI_KEY=your_rapidapi_key
```

## Usage

### 1. Scrape Leads
- Go to the Scraper module
- Enter niche (e.g., "SaaS", "E-Commerce")
- Enter location (e.g., "New York, USA", "London, UK")
- Click "Scrape" to find leads
- Add leads to CRM

### 2. Generate Personalized Emails
- Go to Email Writer module
- Select a lead from CRM
- Choose tone (Professional, Casual, Friendly)
- Choose purpose (Introduction, Partnership, Sales, Networking)
- Click "Generate Email"
- Edit if needed
- Copy or send

### 3. Send Bulk Emails
The system automatically:
- Rotates through available SMTP accounts
- Tracks daily limits per account
- Queues emails when capacity is reached
- Retries failed emails
- Logs all activity

### 4. Monitor Performance
- View SMTP account usage in real-time
- Track email open rates (requires tracking pixels)
- Monitor campaign performance
- Check email queue status

## Best Practices

### Email Deliverability
1. **Warm up new accounts**: Start with 10-20 emails/day, gradually increase
2. **Use custom domains**: Better than generic Gmail/Outlook
3. **Set up authentication**: SPF, DKIM, DMARC records
4. **Personalize content**: Use company-specific details
5. **Avoid spam triggers**: No ALL CAPS, excessive links, or spam words
6. **Include unsubscribe**: Always provide opt-out option

### Rate Limiting
- System automatically spaces emails 1 second apart
- Accounts rotate using round-robin algorithm
- Daily limits reset at midnight UTC
- Failed emails automatically retry

### Content Strategy
1. **Research leads**: Use company context for personalization
2. **A/B test subject lines**: Try different approaches
3. **Keep it short**: 50-150 words is ideal
4. **Clear CTA**: One specific action per email
5. **Follow up**: 2-3 follow-ups increase response rates by 50%

## Scaling to 6,000 Emails/Day

### Timeline
- **Week 1**: Add 10 accounts, send 500 emails/day
- **Week 2**: Add 20 accounts, send 1,500 emails/day
- **Week 3**: Add 30 accounts, send 3,000 emails/day
- **Week 4**: Add 60 accounts, send 6,000 emails/day

### Cost Estimate
- **Free tier**: 60 Gmail accounts = $0/month (6,000 emails/day)
- **Budget tier**: Mix of free + paid = $50-100/month
- **Professional**: SendGrid/Mailgun = $200-500/month (better deliverability)

## Troubleshooting

### "No SMTP accounts available"
- Add more SMTP accounts
- Check if accounts have reached daily limit
- Verify account status (should be "active")

### "Failed to send email"
- Check SMTP credentials
- Verify app password (for Gmail)
- Check account status
- Review error logs in email_queue table

### Low deliverability
- Warm up accounts gradually
- Set up SPF/DKIM/DMARC
- Improve email content
- Use custom domains
- Check spam score

### Account marked as "error"
- Re-verify credentials
- Check if account is locked
- Generate new app password
- Update account in SMTP Manager

## Advanced Features

### Email Tracking
Add tracking pixels to monitor opens:
```html
<img src="https://yourdomain.com/track/{{email_id}}" width="1" height="1" />
```

### Link Tracking
Wrap links with tracking URLs:
```
https://yourdomain.com/click/{{email_id}}/{{link_id}}
```

### A/B Testing
Create multiple campaigns with different:
- Subject lines
- Email tones
- CTAs
- Send times

### Automated Follow-ups
Set up sequences:
1. Initial email (Day 0)
2. Follow-up 1 (Day 3)
3. Follow-up 2 (Day 7)
4. Final follow-up (Day 14)

## Security Notes

⚠️ **Important**: In production, encrypt SMTP passwords before storing in database:
```typescript
// Use a library like crypto or bcrypt
import crypto from 'crypto';

const encryptPassword = (password: string) => {
  const algorithm = 'aes-256-cbc';
  const key = process.env.ENCRYPTION_KEY;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(key), iv);
  let encrypted = cipher.update(password);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
};
```

## Support

For issues or questions:
1. Check error logs in `email_queue` table
2. Review SMTP account status
3. Test with a single account first
4. Verify credentials and settings

## Next Steps

1. ✅ Run database migration
2. ✅ Install dependencies
3. ✅ Add your first SMTP account
4. ✅ Test with a single email
5. ✅ Gradually add more accounts
6. ✅ Start sending personalized emails!
