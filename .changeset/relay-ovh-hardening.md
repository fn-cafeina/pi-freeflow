---
"pi-freeflow": patch
---

Relay and OVH reliability fixes:

- Edge relays now strip visitor-IP and platform headers before forwarding, so a relay hides the caller and per-IP limits can actually be spread across egresses.
- OVH requests no longer share one timeout across the whole relay roll: a stalled relay cools down and rolls instead of ending in a silent 502 after five minutes.
- Cooling relays are skipped for OVH instead of costing a rate-limit round-trip on every turn, and an OVH rate limit no longer cools the same relay for OpenCode Zen.
- The Responses output cap is mapped to the chat token cap instead of being dropped, so long turns can be bounded again.
- Qwen3.8 27B now exposes its native `low`/`medium`/`xhigh` reasoning ladder. `xhigh` remains the model default; unsupported `minimal`/`high`/`max` values are dropped instead of starving the turn.
- The relay header timeout now follows the per-attempt budget instead of a hidden 60-second cap.
