---
"pi-freeflow": minor
---

Enable relay pool routing for OVHcloud AI Endpoints to bypass per-IP rate limits during burst and subagent requests. Retire paid `z-ai/glm-5.3-flash` and update the Cline lane to true free-tier models (`cline/nemotron-3.5-super-vl`). Implement dynamic Cline version fetching from Open VSX with disk caching, and background keep-alive auto-probing so saved Cline account tokens never expire.
