# @snapdragon-ai/gateway

Embeddable TypeScript facade for the Rust-first Snapdragon gateway.

The Rust crates own actor scheduling, mailboxes, supervision, budgets, and
state-machine semantics. This package provides the host-facing contracts and a
small inline harness for tests and lightweight embedding.

## Runtime Shape

The public TypeScript API is intentionally small and serializable:

- `GatewayEnvelope` for actor messages.
- `GatewayReceiveFilter` for selective receive by kind, source, correlation id,
  and capability.
- `GatewayServiceSpec` for scheduled or manually-run services.
- `GatewayServiceWorkerSpec` for native worker commands managed by the Rust
  daemon.
- `GatewayJobSpec`, `GatewayJobStatus`, and `GatewayLease` for durable work
  queues.
- `GatewayEventRecord` and `GatewayLogRecord` for inspectable orchestration
  history.
- Registry, capability, channel, and ETS-like table snapshots.

The inline client is useful for package tests and applications that want the
contracts without a native daemon. The Rust client talks to the local daemon over
IPC and is the intended runtime for long-lived background work.

## Service Workers

Services may be registered with an in-process runner or a worker command:

```ts
import type { GatewayServiceSpec } from '@snapdragon-ai/gateway';

const spec: GatewayServiceSpec = {
  name: 'session-index',
  enabled: true,
  intervalMs: 60_000,
  startupDelayMs: 2_000,
  restart: 'transient',
  restartIntensity: { maxRestarts: 3, withinMs: 60_000 },
  backoffMs: 1_000,
  maxBackoffMs: 60_000,
  worker: {
    command: process.execPath,
    args: ['path/to/sd.js', 'gateway', 'worker', 'run', 'session-index'],
  },
};
```

The daemon is responsible for scheduling, enable/disable state, run counters,
errors, backoff, restart intensity, and status summaries. Worker processes are
deliberately headless: the product using the gateway decides what runtime
dependencies a service needs.

## Durable Jobs

The Rust daemon can be started with a SQLite store path. In that mode it keeps
jobs, events, service state, leases, and logs under the gateway root:

```ts
const job = await gateway.enqueueJob({
  kind: 'agent.run',
  payload: { prompt: 'run the release checks' },
});
const lease = await gateway.acquireJob('default', 'worker-1');
if (lease) await gateway.completeJob(lease.job.id, { ok: true });
```

The inline client implements the same lifecycle in memory for tests and small
embedders.

## Sandbox Contracts

`GatewaySandboxSpec` and `GatewaySandboxLease` describe project-scoped execution
spaces without baking in a backend. The first `sd` backend is local git
worktrees with optional linked reference roots; richer providers such as
OpenShell, Docker, microVMs, or remote sandboxes should implement the same lease
shape instead of coupling callers to a specific runtime.

## Observability

`gateway.status()` exposes the operator snapshot used by `sd gateway status`:
registered service tasks, queue depths, active leases, recent failures, tables,
process count, worker process snapshots, pid, and uptime. Service workers are
spawned with explicit timeout enforcement, so budget expiry kills the child
process and records a `timed_out` worker state. The daemon also expires stale
job leases during status/watchdog passes so stuck jobs can become visible and
recoverable without requiring a foreground TUI process.

## Current Boundaries

This package defines local-first gateway contracts. Distributed transport
interfaces are part of the design direction, but Iroh clustering, appliance UI
assets, and full remote service routing are later layers.
