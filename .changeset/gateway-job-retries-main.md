---
"@snapdragon-ai/gateway": minor
"@snapdragon-ai/sd": minor
---

Add gateway job retry controls. Failed jobs with attempts remaining requeue
automatically, terminal failed jobs can be retried through the TypeScript
client, Rust IPC, REST, and `sd gateway jobs retry`, while cancelled jobs remain
terminal.
