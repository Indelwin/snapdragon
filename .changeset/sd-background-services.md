---
"@snapdragon-ai/sd": minor
---

Add an `sd` background services gateway that owns the lifecycle, scheduling, and status surface for in-process workers. The existing memory worker is now registered as one such service (via `memoryWorkerService()`), and a placeholder `skillBuilderService()` is wired in for the upcoming auto skill builder. Adds a `--noBackground` runtime option that disables every background service in one shot; the legacy `--noMemoryWorker` keeps working and only disables that one service. Public API: `startSdBackgroundServices`, `defaultSdBackgroundServices`, `SdBackgroundService`, `SdBackgroundServicesHandle`, and `SdBackgroundServiceStatus`.
