---
id: decideAction
name: Decide Action
version: 1.0.0
trigger: after_verification
---

# Decide Action

Apply deterministic lead routing.

## Rules
- Safety beats LLM.
- Verified official-domain email plus exact evidence may auto_queue.
- Missing safe email becomes review, phone_only, or rejected.

