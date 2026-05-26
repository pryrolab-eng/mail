---
id: extractContacts
name: Extract Contacts
version: 1.0.0
trigger: after_evidence_collection
---

# Extract Contacts

Extract contact points from official evidence.

## Rules
- Accept emails from text/mailto.
- Accept phones from tel links or clearly labeled phone text only.
- Reject CSS numbers, coordinates, IDs, timestamps, and unlabeled digit soup.

