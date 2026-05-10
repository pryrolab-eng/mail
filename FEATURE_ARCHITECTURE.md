# 🏗️ Feature Architecture - Visual Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                            │
│                     (Platform Layout)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SIDEBAR NAVIGATION                          │
├─────────────────────────────────────────────────────────────────┤
│  📊 Scraper          │  ✉️ Email Writer    │  📈 Analytics      │
│  👥 CRM              │  📣 Campaigns ⭐     │  ⚙️ SMTP Manager   │
│  📝 Templates ⭐     │  🔄 Follow-Up        │  🤖 AI Settings    │
│  🛡️ Verification ⭐  │  🔀 Sequences ⭐     │                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MODULE COMPONENTS                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  CampaignsModule │  │ TemplatesModule  │  │ Verification │ │
│  │                  │  │                  │  │   Module     │ │
│  │  • Create        │  │  • Create        │  │  • Verify    │ │
│  │  • Schedule      │  │  • Edit          │  │  • Score     │ │
│  │  • Track         │  │  • Duplicate     │  │  • Filter    │ │
│  │  • Manage        │  │  • Variables     │  │  • Export    │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                  │
│  ┌──────────────────┐                                           │
│  │ SequencesModule  │                                           │
│  │                  │                                           │
│  │  • Build Steps   │                                           │
│  │  • Set Delays    │                                           │
│  │  • Visual Flow   │                                           │
│  │  • Auto-Send     │                                           │
│  └──────────────────┘                                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SUPABASE DATABASE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ email_campaigns  │  │ email_templates  │  │    leads     │ │
│  │                  │  │                  │  │              │ │
│  │  • id            │  │  • id            │  │  • email     │ │
│  │  • name          │  │  • name          │  │  • verified  │ │
│  │  • status        │  │  • subject       │  │  • score     │ │
│  │  • scheduled_at  │  │  • body          │  │  • status    │ │
│  │  • stats         │  │  • variables     │  │              │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │ email_sequences  │  │  sent_emails     │                    │
│  │                  │  │                  │                    │
│  │  • campaign_id   │  │  • lead_id       │                    │
│  │  • step_number   │  │  • opened_at     │                    │
│  │  • delay_days    │  │  • clicked_at    │                    │
│  │  • template      │  │  • replied_at    │                    │
│  └──────────────────┘  └──────────────────┘                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Campaign Creation Flow
```
User Input
    │
    ▼
CampaignsModule
    │
    ├─→ Validate Input
    │
    ├─→ Save to Database (email_campaigns)
    │
    ├─→ Set Status (draft/scheduled)
    │
    └─→ Show Success Toast
```

### 2. Template Usage Flow
```
User Creates Template
    │
    ▼
TemplatesModule
    │
    ├─→ Extract Variables ({{company_name}}, etc.)
    │
    ├─→ Save to Database (email_templates)
    │
    └─→ Available in Library
         │
         ▼
    Email Writer
         │
         ├─→ Load Template
         │
         ├─→ Replace Variables with Lead Data
         │
         └─→ Generate Personalized Email
```

### 3. Email Verification Flow
```
User Clicks "Verify All Leads"
    │
    ▼
EmailVerificationModule
    │
    ├─→ Fetch All Leads from CRM
    │
    ├─→ Batch Verify (email-verifier.ts)
    │   │
    │   ├─→ Format Check
    │   ├─→ DNS MX Check
    │   ├─→ Disposable Check
    │   └─→ Calculate Score (0-100)
    │
    ├─→ Update Leads Table
    │   │
    │   ├─→ email_verified = true/false
    │   └─→ confidence_score = 0-100
    │
    └─→ Show Results + Stats
```

### 4. Sequence Automation Flow
```
Campaign Created
    │
    ▼
User Builds Sequence
    │
    ├─→ Step 1: Initial Email (Day 0)
    │
    ├─→ Step 2: Follow-up (Day 3)
    │
    ├─→ Step 3: Follow-up (Day 7)
    │
    └─→ Step 4: Final Follow-up (Day 14)
         │
         ▼
    Background Worker (Future)
         │
         ├─→ Check followup_queue
         │
         ├─→ Send Due Follow-ups
         │
         └─→ Update sent_emails
```

### 5. Scheduled Campaign Flow
```
User Schedules Campaign
    │
    ├─→ Set scheduled_at = "2026-05-15 09:00"
    │
    ├─→ Status = "scheduled"
    │
    └─→ Save to Database
         │
         ▼
    Cron Job (Future)
         │
         ├─→ Check for due campaigns
         │
         ├─→ Send emails at scheduled time
         │
         └─→ Update status = "active"
```

---

## Component Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                     PlatformLayout                          │
│  (Main container - manages active module)                   │
└─────────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Campaigns   │  │  Templates   │  │ Verification │
│   Module     │  │   Module     │  │   Module     │
└──────────────┘  └──────────────┘  └──────────────┘
        │                │                │
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
                ┌──────────────┐
                │   Supabase   │
                │   Database   │
                └──────────────┘
                         │
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Real-time   │  │     RLS      │  │   Indexes    │
│ Subscriptions│  │   Policies   │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## Feature Integration Map

### ✅ Fully Integrated (In Sidebar):
```
Scraper ──────┐
              │
CRM ──────────┼──→ Platform Layout ──→ User Interface
              │
Email Writer ─┤
              │
Campaigns ────┤  ⭐ NEW
              │
Templates ────┘  ⭐ NEW
```

### 📦 Ready to Integrate (Optional):
```
Verification ─┐
              ├──→ Can be added to sidebar
Sequences ────┘
```

---

## State Management

### Component State:
```
CampaignsModule
├── campaigns: Campaign[]
├── selectedCampaign: Campaign | null
├── loading: boolean
├── showCreateModal: boolean
└── formState: { name, subject, body, ... }

TemplatesModule
├── templates: Template[]
├── editingTemplate: Template | null
├── loading: boolean
├── showCreateModal: boolean
└── formState: { name, subject, body, ... }

VerificationModule
├── results: VerificationResult[]
├── progress: { completed, total }
├── verifying: boolean
└── filterScore: number

SequencesModule
├── campaigns: Campaign[]
├── sequences: Sequence[]
├── selectedCampaignId: string
├── loading: boolean
└── showCreateModal: boolean
```

### Real-time Subscriptions:
```
Supabase Channel
    │
    ├─→ email_campaigns (INSERT, UPDATE, DELETE)
    │   └─→ Auto-refresh CampaignsModule
    │
    ├─→ email_templates (INSERT, UPDATE, DELETE)
    │   └─→ Auto-refresh TemplatesModule
    │
    └─→ sent_emails (UPDATE)
        └─→ Auto-refresh Analytics
```

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Authentication Layer                      │
│                  (Supabase Auth)                             │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Row Level Security (RLS)                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  email_campaigns:  WHERE user_id = auth.uid()               │
│  email_templates:  WHERE user_id = auth.uid()               │
│  leads:            WHERE user_id = auth.uid()               │
│  email_sequences:  WHERE campaign.user_id = auth.uid()      │
│  sent_emails:      WHERE user_id = auth.uid()               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Access                               │
│         (Users can only see their own data)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Performance Optimization

### Lazy Loading:
```
User Opens Platform
    │
    ├─→ Load PlatformLayout (always)
    │
    ├─→ Load Sidebar (always)
    │
    └─→ Load Active Module Only
         │
         ├─→ Scraper (if active)
         ├─→ CRM (if active)
         ├─→ Campaigns (if active) ⭐
         ├─→ Templates (if active) ⭐
         └─→ etc.
```

### Real-time Updates:
```
Database Change
    │
    ├─→ Supabase Realtime
    │
    ├─→ Channel Subscription
    │
    └─→ Component Auto-refresh
         │
         └─→ No manual refresh needed
```

### Batch Operations:
```
Verify 100 Emails
    │
    ├─→ Batch into groups of 10
    │
    ├─→ Process each batch
    │
    ├─→ Update progress bar
    │
    └─→ Rate limiting (1s delay)
```

---

## Future Enhancements

### Phase 1 (Automation):
```
Cron Job
    │
    ├─→ Check scheduled campaigns
    │
    ├─→ Send at scheduled time
    │
    └─→ Update campaign status

Background Worker
    │
    ├─→ Check followup_queue
    │
    ├─→ Send due follow-ups
    │
    └─→ Update sent_emails
```

### Phase 2 (Advanced Features):
```
A/B Testing
    │
    ├─→ Create variants
    │
    ├─→ Split traffic
    │
    └─→ Track performance

Email Warmup
    │
    ├─→ Gradual send increase
    │
    ├─→ Monitor health score
    │
    └─→ Auto-adjust limits
```

---

## Summary

This architecture provides:
- ✅ **Modular Design** - Each feature is independent
- ✅ **Scalable** - Easy to add new features
- ✅ **Secure** - RLS protects user data
- ✅ **Real-time** - Live updates without refresh
- ✅ **Performant** - Lazy loading and batch operations
- ✅ **Maintainable** - Clean code structure

**All 5 new features integrate seamlessly into this architecture!** 🏗️
