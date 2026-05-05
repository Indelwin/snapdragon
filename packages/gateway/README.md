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
  worker: {
    command: process.execPath,
    args: ['path/to/sd.js', 'gateway', 'worker', 'run', 'session-index'],
  },
};
```

The daemon is responsible for scheduling, enable/disable state, run counters,
errors, and status summaries. Worker processes are deliberately headless: the
product using the gateway decides what runtime dependencies a service needs.

## Current Boundaries

This package defines local-first gateway contracts. Distributed transport
interfaces are part of the design direction, but Iroh clustering, appliance UI
assets, and full remote service routing are later layers.
