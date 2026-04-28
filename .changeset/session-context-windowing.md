---
"@snapdragon-ai/session": minor
"@snapdragon-ai/agent": minor
"@snapdragon-ai/sd": minor
---

Add append-only JSONL context chunks, deterministic fresh-tail context assembly, and automatic agent-side session compaction. `sd` now enables conservative context windowing by default under `agent.context` while keeping canonical session messages lossless.
