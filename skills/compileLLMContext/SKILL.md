---
id: compileLLMContext
name: Compile LLM Context
version: 1.0.0
trigger: before_llm
---

# Compile LLM Context

Rank and compact evidence before LLM reasoning or writing.

## Rules
- Return typed arrays, never raw text.
- Max 5 facts for email writing.
- Prefer high salesRelevance and payment/services/team facts.
- Attach ownerName when available.
- Missing ownerName blocks auto-send but does not block draft generation.
