---
"@snapdragon-ai/gateway": patch
"@snapdragon-ai/sd": patch
---

Add a durable gateway worker registry with registration, heartbeat, REST, IPC,
world snapshot, and `sd gateway workers` surfaces so external runtime adapters
can remain inspectable while claiming and completing jobs.
