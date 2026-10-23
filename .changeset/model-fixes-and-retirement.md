---
"pi-freeflow": patch
---

Retire unserved `cat-jam-free` (persistent upstream 404), correct `mimo-v2.6-flash-free` input modality to text-only (upstream rejects image input), and strip `max_output_tokens` on the OVH lane so translated Responses requests no longer trigger upstream 400 extra arguments errors. Model catalog count updated from 35 to 34 across documentation and tests.
