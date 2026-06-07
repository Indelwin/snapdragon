---
"@snapdragon-ai/sd": patch
---

Expose worker-side gateway job lifecycle commands from `sd gateway jobs`.
Operators and agent adapters can now acquire queued work, complete jobs with an
optional result artifact, and fail jobs with a clear durable error message.
