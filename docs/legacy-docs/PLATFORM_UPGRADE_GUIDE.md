# Pryro Platform — Complete Upgrade Guide

## What Was Built / Fixed

### ✅ New Features Added

1. **Unified Lead Status System** (8 statuses)
   - `new` → `contacted` → `opened` → `clicked` → `replied` → `interested` → `bounced` → `failed`
   - All modules now communicate through these statuses automatically

2. **Email Tracking System**
   - Open tracking via invisible pixel (`/api/track/open`)
   - Click tracking via redirect (`/api/track/click`)
   - Automatically updates lead status when email is opened/clicked

3. **Analytics Dashboard** (`/analytics` module)
   - Real-time KPI cards: sent, opened, clicked, replied, bounced, failed
   - Daily activity line chart
   - Lead status pie chart
   - SMTP account performance with health scores
   - Campaign performance table

4. **Notifications System**
   - Real-time notifications via Supabase Realtime
   - Bell icon in TopBar with unread count
   - Notifications for: replies, bounces, SMTP errors, campaign completions
   - Database triggers auto-create notifications

5. **CSV Import System** (completely rebuilt)
   - Auto-detects columns from any CSV format (Apollo, Hunter, LinkedIn, Instantly)
   - Visual column mapping UI
   - Email validation before saving
   - Deduplication
   - Progress tracking
   - Error log with failed rows

6. **Bounce Detection**
   - Classifies bounce types: mailbox_not_found, invalid_domain, smtp_rejection, spam_block, temporary_failure
   - Updates lead status to `failed` on send failure
   - Creates notification for failed emails

7. **Database Triggers**
   - Auto-update lead status when email is opened/clicked/bounced
   - Auto-create notifications on new replies
   - Auto-update lead status on reply received

8. **New Navigation Modules**
   - Analytics Dashboard
   - Campaigns (placeholder, routes to Email Writer)
   - Templates (placeholder)

---

## 🚀 Setup Instructions

### Step 1: Run Database Migration

Go to your Supabase project → SQL Editor → Run this file:

```
supabase/migrations/20240610_complete_platform_upgrade.sql
```

This adds:
- New columns to `leads`, `sent_emails`, `smtp_accounts`, `email_campaigns`
- New tables: `notifications`, `csv_imports`, `analytics_events`, `email_templates`
- Database triggers for auto-status updates
- Views: `followup_due`, `analytics_summary`
- RLS policies for all new tables
- Realtime enabled for new tables

### Step 2: Add Environment Variables

Add to `.env.local`:
```env
NEXT_PUBLIC_APP_URL=https://your-domain.com
CRON_SECRET=your-secret-key-here
```

### Step 3: Deploy

```bash
npm run build
vercel deploy
```

---

## 📊 How Systems Communicate

```
Scraper → saves leads with status: "new"
         ↓
Email Writer → sends email → status: "contacted"
         ↓
Tracking Pixel → email opened → status: "opened"
         ↓
Link Click → email clicked → status: "clicked"
         ↓
IMAP Check → reply received → status: "replied"
         ↓
AI Reply → generates response → sends → status: "interested"
         ↓
Bounce → email bounced → status: "bounced"
         ↓
Failed → send failed → status: "failed"
```

All status changes:
1. Update `leads.status`
2. Log to `lead_status_history`
3. Create notification in `notifications`
4. Update campaign stats

---

## 🔧 API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/send-email` | POST | Send single email with tracking |
| `/api/send-bulk` | POST | Send bulk emails with tracking |
| `/api/track/open` | GET | Email open tracking pixel |
| `/api/track/click` | GET | Email click tracking redirect |
| `/api/analytics` | GET | Analytics data |
| `/api/notifications` | GET/POST | Notifications |
| `/api/csv-import` | POST | Import CSV leads |
| `/api/csv-import` | PUT | Auto-detect CSV columns |
| `/api/inbox/check` | POST | Check IMAP for replies |
| `/api/followup/process` | POST | Process scheduled follow-ups |
| `/api/ai/generate-reply` | POST | Generate AI reply |

---

## 📧 Email Tracking Flow

1. Email is sent via `/api/send-email`
2. A unique `tracking_pixel_id` (UUID) is generated
3. A 1x1 pixel is injected: `<img src="/api/track/open?id=UUID">`
4. All links are wrapped: `href="/api/track/click?id=UUID&url=ORIGINAL_URL"`
5. When recipient opens email → pixel fires → lead status → `opened`
6. When recipient clicks link → redirect fires → lead status → `clicked`

---

## 🔔 Notifications

Notifications are created automatically by:
- Database triggers (bounces, replies)
- API routes (failed sends, CSV imports)
- Cron jobs (campaign completions)

Types:
- `reply` — new email reply received
- `bounce` — email bounced
- `smtp_error` — SMTP account error
- `campaign_complete` — campaign finished
- `scrape_done` — scraping job completed
- `failed_email` — email failed to send
- `info` — general information

---

## 📋 CSV Import

Supports any CSV format. Auto-detects these columns:

| Field | Detected From |
|-------|--------------|
| company_name | company, organization, name, business |
| email | email, e-mail, mail |
| phone | phone, tel, mobile, cell |
| website | website, url, domain, web |
| niche | niche, industry, sector, category |
| location | location, city, country, region |
| first_name | first_name, firstname, fname |
| last_name | last_name, lastname, surname |
| notes | notes, description, comment |
| status | status, stage |

---

## 🗄️ Database Schema (New Tables)

### notifications
```sql
id, user_id, type, title, message, data (JSONB), is_read, created_at
```

### csv_imports
```sql
id, user_id, filename, total_rows, imported_rows, failed_rows, duplicate_rows, status, error_log (JSONB), created_at, completed_at
```

### analytics_events
```sql
id, user_id, event_type, sent_email_id, lead_id, campaign_id, metadata (JSONB), ip_address, user_agent, created_at
```

### email_templates
```sql
id, user_id, name, subject, body, tone, niche, variables (JSONB), is_default, created_at, updated_at
```

---

## 🐛 Known Issues Fixed

1. ✅ Lead statuses now match across all modules
2. ✅ CSV import auto-detects columns from any format
3. ✅ Email tracking (opens/clicks) now works
4. ✅ Bounce detection classifies failure types
5. ✅ Notifications system is live
6. ✅ Analytics dashboard shows real data
7. ✅ Scraper saves leads with correct status (`new`)
8. ✅ TopBar shows notifications bell with unread count
9. ✅ Sidebar has all modules including Analytics

---

## 🔮 Next Steps (Future)

1. **Gmail OAuth** for inbox monitoring (currently IMAP only)
2. **Campaign builder** with sequence editor
3. **Template library** with niche-specific templates
4. **A/B testing** for subject lines
5. **Warmup system** for SMTP accounts
6. **Unsubscribe handling** with one-click unsubscribe links
7. **Domain verification** (SPF, DKIM, DMARC checker)
