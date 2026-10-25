---
"pi-freeflow": patch
---

Fix OpenCode Zen free-tier requests being refused with `429 FreeUsageLimitError` when the local proxy daemon originates them with Node's transport. The same request now answers `200` from Bun and `429` from Node on the same machine, in the same minute, with the environment block and every header axis present, so the refusal is a transport check rather than a spent quota. When the host runs on Node, the proxy daemon now prefers a `bun` found on `PATH` and falls back to the host's Node only when Bun is absent; an explicit daemon runtime still wins, and a host already running on Bun keeps its own runtime. The minimum accepted OpenCode client version rises to `1.18.0`, because upstream refuses older versions with `426 UpgradeRequired`.
