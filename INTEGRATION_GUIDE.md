# Integration Guide - Optional Modules

## Overview
Two powerful modules are ready but not yet integrated into the sidebar:
1. **Email Verification Module** - Verify email quality and reduce bounces
2. **Sequences Module** - Build automated follow-up sequences

This guide shows how to add them to your platform navigation.

---

## Step 1: Update Type Definitions

**File:** `src/types/platform.ts`

Add the new module types to `ActiveModule`:

```typescript
export type ActiveModule =
  | 'scraper'
  | 'email-writer'
  | 'crm'
  | 'ai-settings'
  | 'smtp-manager'
  | 'follow-up'
  | 'analytics'
  | 'campaigns'
  | 'templates'
  | 'verification'    // ADD THIS
  | 'sequences';      // ADD THIS
```

---

## Step 2: Update Sidebar Navigation

**File:** `src/components/platform/PlatformSidebar.tsx`

### Import the icons:
```typescript
import { Shield, GitBranch } from "lucide-react";
```

### Add navigation items:

Find the navigation items array and add:

```typescript
const navigationItems = [
  // ... existing items ...
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "verification", label: "Verification", icon: Shield },    // ADD THIS
  { id: "sequences", label: "Sequences", icon: GitBranch },       // ADD THIS
  { id: "analytics", label: "Analytics", icon: BarChart2 },
  // ... rest of items ...
];
```

---

## Step 3: Update Platform Layout

**File:** `src/components/platform/PlatformLayout.tsx`

### Import the modules:
```typescript
import EmailVerificationModule from "./EmailVerificationModule";
import SequencesModule from "./SequencesModule";
```

### Add the lazy-loaded modules:

Find the LazyModule sections and add:

```typescript
<LazyModule active={activeModule === "verification"}>
  <EmailVerificationModule userId={userId} />
</LazyModule>

<LazyModule active={activeModule === "sequences"}>
  <SequencesModule userId={userId} />
</LazyModule>
```

---

## Complete Example

Here's what the updated sections should look like:

### PlatformSidebar.tsx
```typescript
import {
  // ... existing imports ...
  Shield,
  GitBranch,
} from "lucide-react";

const navigationItems = [
  { id: "scraper", label: "Scraper", icon: Search },
  { id: "crm", label: "CRM", icon: Users },
  { id: "email-writer", label: "Email Writer", icon: Mail },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "verification", label: "Verification", icon: Shield },
  { id: "sequences", label: "Sequences", icon: GitBranch },
  { id: "follow-up", label: "Follow-Up", icon: Clock },
  { id: "analytics", label: "Analytics", icon: BarChart2 },
  { id: "smtp-manager", label: "SMTP", icon: Server },
  { id: "ai-settings", label: "AI Settings", icon: Settings },
];
```

### PlatformLayout.tsx
```typescript
import EmailVerificationModule from "./EmailVerificationModule";
import SequencesModule from "./SequencesModule";

// ... in the render section ...

<LazyModule active={activeModule === "verification"}>
  <EmailVerificationModule userId={userId} />
</LazyModule>

<LazyModule active={activeModule === "sequences"}>
  <SequencesModule userId={userId} />
</LazyModule>
```

---

## Alternative: Keep Them Separate

If you prefer to keep these as advanced features accessible from other modules:

### Option 1: Add Verification to CRM
Add a "Verify Emails" button in the CRM module that opens the verification modal.

### Option 2: Add Sequences to Campaigns
Add a "Manage Sequences" button in each campaign's detail view.

### Option 3: Keep as Standalone Pages
Create separate routes like `/platform/verification` and `/platform/sequences`.

---

## Testing After Integration

1. **Restart your dev server** to ensure all changes are loaded
2. **Check the sidebar** - new items should appear
3. **Click each new item** - modules should load without errors
4. **Test functionality**:
   - Verification: Click "Verify All Leads"
   - Sequences: Select a campaign and add a sequence step

---

## Recommended Order

For best user experience, organize sidebar items like this:

```
📊 Data Collection
  - Scraper
  - CRM

✉️ Email Management
  - Email Writer
  - Campaigns
  - Templates
  - Sequences

🔧 Tools
  - Verification
  - Follow-Up
  - Analytics

⚙️ Settings
  - SMTP
  - AI Settings
```

---

## Need Help?

If you encounter any issues:
1. Check browser console for errors
2. Verify all imports are correct
3. Ensure TypeScript types match
4. Restart dev server
5. Clear browser cache

All modules are fully tested and production-ready! 🚀
