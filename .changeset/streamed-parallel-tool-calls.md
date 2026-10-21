---
"pi-freeflow": patch
---

Parallel tool calls streamed through the proxy no longer corrupt each other.

Several free models label every parallel tool call with the same index while still giving each call its own id. On streamed turns the proxy merged calls by index alone, so the argument fragments of two parallel calls interleaved into one packet: one call could vanish entirely, or the arguments came through as glued-alongside JSON the host had to reject (which looked like the model failing at tool calling and the turn being retried). Streamed tool calls are now tracked the same way the assembled (non-streamed) ones always were — per call id, falling back to the wire index only when a call carries none — and a call whose index collides with another is renumbered so the host still sees two well-formed, re-executable calls. Streams with a single tool call are byte-for-byte unchanged.
