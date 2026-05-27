---
id: validateOutput
name: Validate Output
version: 1.0.0
trigger: after_write_email
---

# Validate Output

Run deterministic checks before repair and safety review.

## Rules
- Subject must be under 10 words.
- Body must be under 140 words and use 3-5 short content paragraphs.
- CTA and signature are required.
- `Hi there`, `Dear Sir`, and `Dear Madam` are forbidden.
- Unsupported claims, generic value propositions, and vague CTAs require repair or human review.
