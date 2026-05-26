---
id: verifyOwnership
name: Verify Ownership
version: 1.0.0
trigger: after_contact_extraction
---

# Verify Ownership

Verify whether contacts are safe for automated outreach.

## Rules
- Check MX for email domains.
- Auto-send requires verified email domain matching official website domain.
- Free, suppressed, invalid, or unmatched emails are review-only.

