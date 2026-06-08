---
"@snapdragon-ai/gateway": patch
---

Expose REST job lifecycle routes for worker adapters. External clients can now
acquire queued work, complete jobs with result artifacts, and fail jobs with
durable error messages through the local REST facade.
