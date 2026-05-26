---
id: extractBusinessFacts
name: Extract Business Facts
version: 1.0.0
trigger: after_page_fetch
---

# Extract Business Facts

Convert public page content into typed, sourced facts.

## Rules
- Output typed facts only.
- Every fact requires category, source, confidence, and salesRelevance.
- Strip FAQ filler, reviews, header/nav blobs, and generic marketing.
- Do not classify bios as services.

