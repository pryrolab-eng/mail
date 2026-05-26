---
id: fetchTargetedPages
name: Fetch Targeted Pages
version: 1.0.0
trigger: after_domain_found
---

# Fetch Targeted Pages

Fetch high-value pages from an official domain.

## Rules
- Try services, about, team/doctors, pricing/payment, contact, and homepage.
- Skip 404, empty, blocked, or JavaScript-only pages.
- Store full evidence, but never pass raw page text to email writing.

