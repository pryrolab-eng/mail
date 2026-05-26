# Implementation Plan: Auto-fill Profile & Email Tracking

## Issue 1: Auto-fill "Your Company" and "Your Service" Fields

### Current State
- Fields are empty by default
- User must manually fill them every time
- Data IS being saved to database (`sender_company`, `sender_service`)
- Data IS being loaded on component mount

### Problem
The `loadSenderProfile()` function exists and is called, but the fields appear empty in your screenshot.

### Solution
The code already has the auto-fill logic! Check if:
1. The `users` table has `sender_company` and `sender_service` columns
2. Your user record has these fields populated

### To Fix (if columns don't exist):

**Run this SQL in Supabase:**
```sql
-- Add columns if they don't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS sender_company TEXT,
ADD COLUMN IF NOT EXISTS sender_service TEXT;

-- Update your user record
UPDATE users 
SET sender_company = 'Your Company Name',
    sender_service = 'Your Service/Product'
WHERE id = 'your-user-id';
```

The fields will then auto-fill on page load.

---

## Issue 2: Email Tracking System

### Requirements
1. When email is sent successfully → move lead to "EMAIL SENT" column
2. When email fails → move lead to "DEAD" column
3. Track sent emails in database
4. Show email history in lead drawer

### Current State
- CRM has kanban board with statuses
- Email sending happens in `EmailWriterModule`
- No automatic status update after sending

### Implementation Steps

#### Step 1: Update `sendBulkEmailsChunkedAction` in `actions.ts`

After each email is sent, update the lead status:

```typescript
if (result.success) {
  results.sent++;
  
  // ✅ ADD THIS: Update lead status to "Email Sent"
  await supabase
    .from('leads')
    .update({ 
      status: 'Email Sent',
      updated_at: new Date().toISOString()
    })
    .eq('id', email.lead_id);
    
  // Log to email_queue...
} else {
  results.failed++;
  
  // ✅ ADD THIS: Update lead status to "Dead" for failed emails
  await supabase
    .from('leads')
    .update({ 
      status: 'Dead',
      updated_at: new Date().toISOString()
    })
    .eq('id', email.lead_id);
    
  // Log failure...
}
```

#### Step 2: Create Email History Table

**Run this SQL in Supabase:**
```sql
CREATE TABLE IF NOT EXISTS email_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,
  
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'bounced', 'opened', 'clicked')),
  smtp_account_id UUID REFERENCES smtp_accounts(id) ON DELETE SET NULL,
  
  sent_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  
  opened_at TIMESTAMP WITH TIME ZONE,
  clicked_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_email_history_user ON email_history(user_id);
CREATE INDEX idx_email_history_lead ON email_history(lead_id);
CREATE INDEX idx_email_history_status ON email_history(status);
CREATE INDEX idx_email_history_sent_at ON email_history(sent_at DESC);

-- RLS Policies
ALTER TABLE email_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own email history"
  ON email_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own email history"
  ON email_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

#### Step 3: Update CRM Drawer to Show Email History

In `CRMModule.tsx`, add email history fetch:

```typescript
const openDrawer = async (lead: Lead) => {
  setDrawerLead(lead as LeadWithEmails);
  setNotes(lead.notes || "");
  
  // Fetch generated emails
  const { data: generatedEmails } = await supabase
    .from("generated_emails")
    .select("*")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false });
  setDrawerEmails(generatedEmails || []);
  
  // ✅ ADD THIS: Fetch email history
  const { data: emailHistory } = await supabase
    .from("email_history")
    .select("*")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false });
  setEmailHistory(emailHistory || []);
};
```

Then display in the drawer:

```tsx
{/* Email History Section */}
{emailHistory && emailHistory.length > 0 && (
  <div>
    <p className="text-[10px] uppercase tracking-widest mb-2 text-gray-500 font-semibold">
      Email History ({emailHistory.length})
    </p>
    <div className="flex flex-col gap-2">
      {emailHistory.map((email) => (
        <div key={email.id} className="p-3 rounded-lg bg-gray-50 border border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-gray-900">{email.subject}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${
              email.status === 'sent' ? 'bg-green-50 text-green-600' :
              email.status === 'failed' ? 'bg-red-50 text-red-600' :
              'bg-gray-50 text-gray-600'
            }`}>
              {email.status}
            </span>
          </div>
          <p className="text-[10px] text-gray-500">
            {email.sent_at ? new Date(email.sent_at).toLocaleString() : 
             email.failed_at ? `Failed: ${new Date(email.failed_at).toLocaleString()}` : 
             'Pending'}
          </p>
          {email.error_message && (
            <p className="text-[9px] text-red-500 mt-1">{email.error_message}</p>
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

#### Step 4: Update Single Email Send

In `EmailWriterModule.tsx`, after sending single email:

```typescript
const sendEmail = async () => {
  // ... existing send logic ...
  
  if (result.success) {
    // ✅ ADD THIS: Update lead status
    await supabase
      .from('leads')
      .update({ status: 'Email Sent' })
      .eq('id', selectedLead.id);
      
    // ✅ ADD THIS: Log to email history
    await supabase
      .from('email_history')
      .insert({
        user_id: userId,
        lead_id: selectedLead.id,
        recipient_email: selectedLead.email,
        subject: emailSubject,
        body: emailBody,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
      
    toast.success('Email sent and lead updated!');
  } else {
    // ✅ ADD THIS: Mark as failed
    await supabase
      .from('leads')
      .update({ status: 'Dead' })
      .eq('id', selectedLead.id);
      
    await supabase
      .from('email_history')
      .insert({
        user_id: userId,
        lead_id: selectedLead.id,
        recipient_email: selectedLead.email,
        subject: emailSubject,
        body: emailBody,
        status: 'failed',
        failed_at: new Date().toISOString(),
        error_message: result.error,
      });
      
    toast.error('Email failed and lead marked as Dead');
  }
};
```

---

## Issue 3: Remove Duplicate Features

### Current Duplicates (from your screenshot)

Looking at the navigation, you likely have:
- Multiple "Email Writer" entries
- Multiple "CRM" entries
- Multiple "Settings" entries

### Solution

Check `PlatformSidebar.tsx` and remove duplicate menu items:

```typescript
// In PlatformSidebar.tsx
const menuItems = [
  { id: "scraper", label: "Lead Scraper", icon: Search },
  { id: "email-writer", label: "Email Writer", icon: Mail },
  { id: "crm", label: "CRM Pipeline", icon: Users },
  { id: "follow-up", label: "Follow-ups", icon: MessageSquare },
  { id: "smtp-manager", label: "SMTP Accounts", icon: Server },
  { id: "ai-settings", label: "AI Settings", icon: Settings },
  // ❌ Remove any duplicates below this line
];
```

---

## Summary of Changes

### Database Changes (Run in Supabase SQL Editor)
1. Add `sender_company` and `sender_service` columns to `users` table (if missing)
2. Create `email_history` table
3. Set up RLS policies

### Code Changes

**File: `src/app/actions.ts`**
- Update `sendBulkEmailsChunkedAction` to update lead status after send
- Update `sendBulkEmailsAction` (if used) similarly

**File: `src/components/platform/EmailWriterModule.tsx`**
- Update single email send to update lead status
- Log to `email_history` table

**File: `src/components/platform/CRMModule.tsx`**
- Add `emailHistory` state
- Fetch email history in `openDrawer`
- Display email history in drawer

**File: `src/components/platform/PlatformSidebar.tsx`**
- Remove duplicate menu items

---

## Testing Checklist

### Profile Auto-fill
- [ ] Open Email Writer
- [ ] Check if "Your Company" and "Your Service" are pre-filled
- [ ] If not, check database for `sender_company` and `sender_service` columns
- [ ] Manually set values in database and refresh

### Email Tracking
- [ ] Send a test email (single)
- [ ] Check if lead moves to "Email Sent" column in CRM
- [ ] Open lead drawer and verify email appears in history
- [ ] Send an email that will fail (invalid SMTP)
- [ ] Check if lead moves to "Dead" column
- [ ] Verify failure is logged in email history

### Duplicate Removal
- [ ] Check sidebar for duplicate items
- [ ] Remove duplicates from `PlatformSidebar.tsx`
- [ ] Verify navigation works correctly

---

## Quick Start

1. **Run SQL scripts** in Supabase to create tables
2. **Update your user record** with company/service info
3. **Add status update code** to email sending functions
4. **Add email history display** to CRM drawer
5. **Remove duplicate menu items** from sidebar
6. **Test** the complete flow

Would you like me to implement any specific part of this plan?
