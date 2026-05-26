---
id: reviewEmailSafety
name: Review Email Safety
version: 1.0.0
trigger: after_write_email
---

# Review Email Safety

Validate generated outreach before approval.

## Rules
- Block unsupported claims and invented details.
- Parser-recovered output still needs full validation.
- Unsafe drafts go to human review.

