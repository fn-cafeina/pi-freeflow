---
"pi-freeflow": patch
---

Protocol cleanup around reasoning effort, failover limits and tool definitions.

Three small drifts between what a lane accepted and what it advertised are settled. Unsupported reasoning-effort knobs are now clamped on the Chat Completions path exactly as the Responses path already clamped them, so a too-high or unsupported level keeps the turn on the same model instead of walking into an upstream refusal. Failover bodies headed to Kilo now clamp `max_completion_tokens` alongside `max_tokens`, saving a wasted round trip. The user-facing tool definitions now carry `strict` in the position the Chat Completions shape canonically uses, with both positions still accepted when reading a caller's tools back.

The Anthropic-shaped messages lane no longer deletes Anthropic-native forced tool choices (`any` or a named tool) — it was documented to keep the caller's own choice semantics and now actually does; the chat and Responses lanes still normalize choices to `auto`-or-absent as upstream requires.
