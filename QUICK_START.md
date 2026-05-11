# ⚡ Quick Start - New Features

## 🎯 5-Minute Guide to Your New Features

---

## 1️⃣ Email Campaigns (2 minutes)

### Create Your First Campaign:
1. Click **"Campaigns"** in sidebar
2. Click **"New Campaign"** button
3. Fill in:
   - **Name:** "Test Campaign"
   - **Description:** "My first campaign"
   - **Subject:** "Quick question about {{company_name}}"
   - **Body:** "Hi, I noticed {{company_name}} in {{location}}..."
4. Click **"Create Campaign"**

### Schedule a Campaign:
1. When creating campaign, fill in:
   - **Schedule Date:** Tomorrow's date
   - **Schedule Time:** 09:00
2. Campaign status will be "SCHEDULED"
3. Will auto-send at scheduled time (needs cron job)

### View Campaign Stats:
- **Recipients:** How many leads in campaign
- **Sent:** How many emails sent
- **Open Rate:** % who opened
- **Click Rate:** % who clicked
- **Reply Rate:** % who replied
- **Bounce Rate:** % that bounced

---

## 2️⃣ Email Templates (2 minutes)

### Create Your First Template:
1. Click **"Templates"** in sidebar
2. Click **"New Template"** button
3. Fill in:
   - **Name:** "Cold Outreach - Healthcare"
   - **Tone:** "Direct"
   - **Niche:** "Healthcare"
   - **Subject:** "Quick question about {{company_name}}"
   - **Body:** 
     ```
     Hi,

     I noticed {{company_name}} in {{location}} and wanted to reach out.

     We help {{niche}} businesses with [your service].

     Would you be open to a quick call?

     Best,
     {{your_company}}
     ```
4. Click **"Create Template"**

### Use Variables:
Common variables you can use:
- `{{company_name}}` - Lead's company name
- `{{location}}` - Lead's location
- `{{niche}}` - Lead's niche/industry
- `{{your_company}}` - Your company name
- `{{your_service}}` - Your service/product

### Reuse Templates:
1. Templates are saved in library
2. Click "Edit" to modify
3. Click "Duplicate" to create variations
4. Set as "Default" for quick access

---

## 3️⃣ Email Verification (Optional - 1 minute)

### If You Want to Add It:
1. Open `INTEGRATION_GUIDE.md`
2. Follow 3 simple steps
3. Takes 5 minutes total

### What It Does:
- Verifies all emails in your CRM
- Scores each email 0-100
- Removes fake/disposable emails
- Updates lead confidence scores

### When to Use:
- Before sending big campaigns
- After importing new leads
- Every 3 months for maintenance

---

## 4️⃣ Follow-Up Sequences (Optional - 1 minute)

### If You Want to Add It:
1. Open `INTEGRATION_GUIDE.md`
2. Follow 3 simple steps
3. Takes 5 minutes total

### What It Does:
- Creates multi-step follow-up sequences
- Automatically sends follow-ups after X days
- Links to campaigns
- Visual sequence flow

### Example Sequence:
1. **Initial Email** → Day 0
2. **Follow-up #1** → Day 3 (if no reply)
3. **Follow-up #2** → Day 7 (if no reply)
4. **Follow-up #3** → Day 14 (if no reply)

---

## 🎯 Recommended Workflow

### For New Users:
1. **Scrape leads** (Scraper module)
2. **Add to CRM** (CRM module)
3. **Create template** (Templates module)
4. **Create campaign** (Campaigns module)
5. **Generate emails** (Email Writer module)
6. **Send campaign** (Email Writer module)
7. **Track results** (Analytics module)

### For Advanced Users:
1. **Scrape leads** (Scraper module)
2. **Verify emails** (Verification module) ⭐ NEW
3. **Add to CRM** (CRM module)
4. **Create templates** (Templates module) ⭐ NEW
5. **Create campaign** (Campaigns module) ⭐ NEW
6. **Build sequence** (Sequences module) ⭐ NEW
7. **Schedule campaign** (Campaigns module) ⭐ NEW
8. **Auto-send** (Background worker)
9. **Track results** (Analytics module)

---

## 💡 Pro Tips

### Campaigns:
✅ **DO:**
- Use descriptive names
- Schedule for 9am-11am local time
- Monitor open rates
- Pause underperforming campaigns

❌ **DON'T:**
- Use generic names like "Campaign 1"
- Send at midnight
- Ignore bounce rates
- Keep sending to bounced emails

### Templates:
✅ **DO:**
- Create templates per niche
- Use variables for personalization
- Keep subject lines under 50 characters
- Test different tones

❌ **DON'T:**
- Use same template for all niches
- Forget to use variables
- Write long subject lines
- Use only one tone

### Verification:
✅ **DO:**
- Verify before big campaigns
- Filter out score < 50
- Re-verify every 3 months
- Export results for records

❌ **DON'T:**
- Skip verification
- Send to unverified emails
- Ignore quality scores
- Verify too frequently (costs time)

### Sequences:
✅ **DO:**
- Keep follow-ups short
- Wait 3-5 days between steps
- Stop after 3 attempts
- Add value in each step

❌ **DON'T:**
- Write long follow-ups
- Send daily follow-ups (spam)
- Send 10+ follow-ups
- Just say "following up"

---

## 🚀 Common Use Cases

### Use Case 1: Cold Outreach Campaign
1. Scrape 100 healthcare clinics
2. Verify emails (keep score > 70)
3. Create "Healthcare Outreach" template
4. Create "Q1 Healthcare" campaign
5. Generate personalized emails
6. Schedule for Monday 9am
7. Track results

### Use Case 2: Follow-Up Sequence
1. Create campaign "Rwanda Clinics"
2. Send initial emails
3. Build 3-step sequence:
   - Day 3: "Just checking in..."
   - Day 7: "Quick question..."
   - Day 14: "Last follow-up..."
4. Sequence runs automatically

### Use Case 3: Template Library
1. Create templates for each niche:
   - Healthcare
   - Education
   - Retail
   - Services
2. Set best one as default
3. Reuse across campaigns
4. Track which performs best

---

## 📊 Success Metrics

### Good Campaign Performance:
- **Open Rate:** > 20%
- **Click Rate:** > 5%
- **Reply Rate:** > 2%
- **Bounce Rate:** < 5%

### If Performance is Low:
- **Low Open Rate:** Improve subject line
- **Low Click Rate:** Add clear CTA
- **Low Reply Rate:** Make offer more compelling
- **High Bounce Rate:** Verify emails first

---

## 🎉 You're Ready!

That's it! You now know how to use all 5 new features.

### Quick Links:
- 📖 **Full Details:** `IMPLEMENTATION_COMPLETE.md`
- 🔧 **Integration:** `INTEGRATION_GUIDE.md`
- 🎊 **Overview:** `WHATS_NEW.md`
- 📋 **Summary:** `FINAL_SUMMARY.md`

**Start with Campaigns and Templates - they're already integrated!** 🚀

---

## ❓ FAQ

**Q: Do I need to integrate Verification and Sequences?**
A: No, they're optional. Campaigns and Templates are already working.

**Q: How do I schedule a campaign?**
A: When creating a campaign, fill in the "Schedule Date" and "Schedule Time" fields.

**Q: Can I edit a template after creating it?**
A: Yes! Click the "Edit" button on any template.

**Q: How do I use variables in templates?**
A: Just type `{{variable_name}}` in your subject or body. Common ones: company_name, location, niche.

**Q: What's a good email verification score?**
A: 80+ is excellent, 50-79 is okay, below 50 is risky.

**Q: How many follow-ups should I send?**
A: 2-3 is ideal. More than 5 is spam.

**Q: Can I duplicate a campaign?**
A: Not yet, but you can reuse templates to create similar campaigns quickly.

**Q: Where do I see campaign results?**
A: In the Campaigns module - each campaign shows real-time stats.

---

**Happy emailing!** 📧✨
