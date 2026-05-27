---
id: writeEmail
name: Write Email
version: 1.0.0
trigger: after_research_approval
---

# Write Email

Write grounded B2B outreach from typed evidence only.

## Rules
- Input must be ranked businessFacts only.
- No raw page text, reviews, FAQ filler, or generic praise.
- Return valid JSON only with escaped \n line breaks.
- Body must start with a named or role salutation, never `Hi there`.
- Body must be 65-115 words excluding signature and use 3-5 short paragraphs.
- First content paragraph must reference a specific sourced business fact.
