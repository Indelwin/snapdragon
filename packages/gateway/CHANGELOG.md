# @snapdragon-ai/gateway

## 0.2.0

### Minor Changes

- 20a9375: Add gateway job retry controls. Failed jobs with attempts remaining requeue
  automatically, terminal failed jobs can be retried through the TypeScript
  client, Rust IPC, REST, and `sd gateway jobs retry`, while cancelled jobs remain
  terminal.
- 20a9375: Add a typed REST/SSE client for the public gateway route surface.
- 20a9375: Add REST runtime probe routes for checking and optionally registering Pi RPC
  agent runtimes through the gateway facade.
- 20a9375: Add gateway-managed sandbox lease registration. Sandbox leases are now part of
  the TypeScript client, Rust IPC daemon store, world snapshots, REST routes, and
  `sd gateway sandboxes` daemon sync path so management UIs and agents can inspect
  local worktree ownership before the UI layer lands.
- fa4ee6f: Add a first-class gateway worker registry for logical job workers and external
  agent adapters. Workers can register, heartbeat, appear in status/world
  snapshots, be inspected through REST or Rust IPC, and automatically track active
  job leases until completion, failure, cancellation, or lease expiry.
- 20a9375: Add typed gateway world snapshot options and REST/SSE query filters for focused
  agent and management-surface inspection.
- ef36464: Persist gateway agent runtime descriptors and let `sd gateway agents register-pi --save` reuse saved Pi runtimes.
- 0b3e66e: Add a Pi JSONL RPC runtime adapter and route gateway agent jobs to registered Pi runtimes.

### Patch Changes

- 20a9375: Harden REST/SSE integration contracts.

  The REST server now treats path prefixes as full path segments, returns `400`
  for malformed JSON request bodies, and keeps the SSE stream protocol stable when
  writing initial world snapshot events.

- 20a9375: Expose REST job lifecycle routes for worker adapters. External clients can now
  acquire queued work, complete jobs with result artifacts, and fail jobs with
  durable error messages through the local REST facade.
- 20a9375: Add `POST /v1/logs` so worker adapters can publish durable breadcrumb logs
  through the REST facade.
- 4e7f1d2: Add gateway-owned runtime breadcrumbs and cancellation control for Pi agent jobs.
  Workers can append durable logs through the gateway client, cancelled jobs stay
  terminal, and `sd` now aborts running Pi RPC jobs when the gateway job is
  cancelled while preserving inspectable job-targeted logs.
