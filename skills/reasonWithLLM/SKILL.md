---
id: reasonWithLLM
name: Reason With LLM
version: 1.0.0
trigger: after_context_compile
---

# Reason With LLM

Ask Groq/OpenAI-compatible models for structured lead decisions.

## Rules
- Strict JSON only.
- 413/429/errors fall back deterministically.
- LLM recommendation cannot override safety gates.

