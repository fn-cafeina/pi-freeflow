---
"pi-freeflow": patch
---

Stop OVH Qwen models from failing with `400 feature 'extra arguments: {"chat_template_kwargs": …}' is not currently supported`.

The host classifies the loopback proxy as a local OpenAI-compatible backend before model compat overrides land, so `Qwen3.x` ids were treated as template-dialect Qwen and every OVH request carried `chat_template_kwargs` (`enable_thinking`, `preserve_thinking`). OVH's OpenAI-compatible surface rejects those fields. The OVH lane now pins `thinkingFormat: "openai"` and clears `qwenPreserveThinking`, and `handleOvhRequest` strips any Qwen template controls that still reach the proxy.
