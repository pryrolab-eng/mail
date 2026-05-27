---
id: extractOwnerName
name: Extract Owner Name
version: 1.0.0
trigger: after_fetchTargetedPages
---

# Extract Owner Name

Find the owner, founder, doctor, director, or primary decision maker.

## Rules
- Prefer website about, team, doctors, and Google/official snippets.
- Never extract from reviews, testimonials, or comments.
- Never guess a name not explicitly stated.
- If multiple names are found, prefer owner, founder, medical director, chief, or doctor titles.
- If nothing reliable is found, return null and route email for review.
