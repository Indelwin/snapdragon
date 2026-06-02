---
"@snapdragon-ai/gateway": patch
"@snapdragon-ai/sd": patch
---

Add gateway-owned sandbox lease registration across inline, Rust IPC, REST, and
`sd gateway sandboxes` commands so active project workspaces are inspectable
through world snapshots instead of only local lease files.
