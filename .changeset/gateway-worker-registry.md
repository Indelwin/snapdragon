---
"@snapdragon-ai/gateway": minor
---

Add a first-class gateway worker registry for logical job workers and external
agent adapters. Workers can register, heartbeat, appear in status/world
snapshots, be inspected through REST or Rust IPC, and automatically track active
job leases until completion, failure, cancellation, or lease expiry.
