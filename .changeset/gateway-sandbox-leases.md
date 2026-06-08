---
"@snapdragon-ai/gateway": minor
"@snapdragon-ai/sd": minor
---

Add gateway-managed sandbox lease registration. Sandbox leases are now part of
the TypeScript client, Rust IPC daemon store, world snapshots, REST routes, and
`sd gateway sandboxes` daemon sync path so management UIs and agents can inspect
local worktree ownership before the UI layer lands.
