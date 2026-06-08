---
"@snapdragon-ai/sd": minor
---

Register and heartbeat the built-in `agent-jobs` and `learn-jobs` gateway
workers so `sd` exposes idle, running, completed, cancelled, and failed job
worker state through the gateway worker registry before UI work.
