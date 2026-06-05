# @snapdragon-ai/gateway

Embeddable TypeScript facade for the Rust-first Snapdragon gateway.

The Rust crates own actor scheduling, mailboxes, supervision, budgets, and
state-machine semantics. This package provides the host-facing contracts and a
small inline harness for tests and lightweight embedding. It is designed to
stay npm-installable while the daemon remains the durable orchestration engine.

## Runtime Shape

The public TypeScript API is intentionally small and serializable:

- `GatewayEnvelope` for actor messages.
- `GatewayReceiveFilter` for selective receive by kind, source, correlation id,
  and capability.
- `GatewayServiceSpec` for scheduled or manually-run services.
- `GatewayServiceWorkerSpec` for native worker commands managed by the Rust
  daemon.
- `GatewayAgentRuntimeDescriptor` for external runtimes such as `sd`, Codex,
  Hermes Agent, Pi Agent, and custom workers.
- `GatewayWorkerRegistration`, `GatewayWorkerHeartbeat`, and
  `GatewayWorkerRecord` for durable worker registry state.
- `GatewayJobSpec`, `GatewayJobStatus`, and `GatewayLease` for durable work
  queues.
- `GatewayEventRecord` and `GatewayLogRecord` for inspectable orchestration
  history.
- `GatewayWorldSnapshot` for dashboard, REST, and agent-facing inspection.
- `GatewaySandboxSpec` and `GatewaySandboxLease` for project-scoped execution
  spaces.
- Registry, capability, channel, and ETS-like table snapshots.

The inline client is useful for package tests and applications that want the
contracts without a native daemon. The Rust client talks to the local daemon over
IPC and is the intended runtime for long-lived background work.

## Gateway ECS World

The public API uses concrete gateway nouns even though the internal model is
ECS-shaped. Agents, workers, services, jobs, channels, sessions, capabilities,
sandboxes, approvals, and projects are the entities operators and agents care
about. Systems such as schedulers, supervisors, dispatchers, policy evaluators,
and log projectors act on those entities through the daemon.

```ts
import { InlineGatewayClient } from '@snapdragon-ai/gateway';

const gateway = new InlineGatewayClient();
await gateway.registerAgentRuntime({
  id: 'codex',
  kind: 'codex',
  protocol: 'command',
  command: { command: 'codex', args: ['--json'] },
  supportedJobKinds: ['agent.run'],
  capabilities: ['tools.shell', 'repo.edit'],
  isolation: 'sandbox',
});

const snapshot = await gateway.worldSnapshot();
console.log(snapshot.agentRuntimes.map((runtime) => runtime.id));
```

Workers register as durable entities before or while they claim work:

```ts
await gateway.registerWorker({
  id: 'pi-worker-1',
  queue: 'default',
  runtimeId: 'pi',
  capabilities: ['agent.run', 'tools.pi'],
  status: 'ready',
});

await gateway.heartbeatWorker({
  id: 'pi-worker-1',
  state: 'idle',
  status: 'waiting for work',
});
```

The daemon also auto-creates a worker record when an unregistered worker acquires
a job lease. That keeps ad-hoc adapters visible in world snapshots while still
letting managed runtimes provide richer runtime, service, capability, and status
metadata.

## Pi RPC Runtime Adapter

Pi Agent is the first external runtime adapter. The gateway facade talks to the
installed `pi` binary over Pi's JSONL RPC mode, so the user's existing
`~/.pi/agent` configuration, extensions, skills, prompt templates, sessions,
and provider credentials remain owned by Pi instead of being re-hosted in
Snapdragon.

```ts
import {
  createPiRpcRuntimeDescriptor,
  probePiRpcRuntime,
  runPiRpcAgentJob,
  RustGatewayClient,
} from '@snapdragon-ai/gateway';

const gateway = new RustGatewayClient({ socketPath: '/tmp/snapdragon-gateway.sock' });

await gateway.registerAgentRuntime(createPiRpcRuntimeDescriptor());

const healthCheckedDescriptor = await probePiRpcRuntime();
await gateway.registerAgentRuntime(healthCheckedDescriptor);

const result = await runPiRpcAgentJob({
  prompt: 'Inspect this project and identify the next useful task.',
  targetRuntimeId: 'pi',
  session: 'new',
}, {
  onEvent: (event) => gateway.appendLog({
    target: 'job_123',
    message: `agent runtime event: ${event.type}`,
    data: { eventType: event.type },
  }),
});

console.log(result.summary);
```

Registered runtime descriptors are durable in the Rust gateway store. A daemon
restart recovers Pi, `sd`, Codex, Hermes, and custom runtime descriptors before
workers lease queued jobs, so orchestration does not depend on a one-shot setup
command still being present in process memory.

The facade validates descriptors before registration: runtime ids must be
URL/config-safe, command-like protocols need a launch command, and advertised
job kinds or capabilities cannot be blank. The Rust daemon performs the same
validation for raw IPC callers before persisting descriptors.

The adapter sends `prompt`, `get_state`, and `get_commands` commands over stdin,
observes streamed message and agent lifecycle events on stdout, and cancels
blocking extension UI prompts by default. Callers can pass `onEvent` to mirror
selected lifecycle events into gateway logs, which is how the `sd` agent-job
worker exposes Pi progress under the durable job id. If the provided
`AbortSignal` fires, the adapter sends Pi an `abort` RPC message before stopping
the child process. That makes it safe for headless job workers while preserving
non-blocking Pi extension status/widget updates for future management UIs.

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
jobs, events, service state, worker records, leases, and logs under the gateway
root:

```ts
const job = await gateway.enqueueJob({
  kind: 'agent.run',
  payload: {
    prompt: 'run the release checks',
    targetRuntimeId: 'codex',
    correlationId: 'release-2026-05-29',
  },
});
const lease = await gateway.acquireJob('default', 'worker-1');
if (lease) await gateway.completeJob(lease.job.id, { ok: true });
```

Workers can also report a failure instead of completion. The daemon requeues the
job while attempts remain, records the failure as job-targeted logs, and leaves
the attempt count visible in snapshots. Once a job reaches its attempt limit it
becomes `failed`; operators or executive agents can call `retryJob(id)` to move
that failed job back to `pending` without losing its last error. Cancellation
remains terminal and is not undone by late worker writes or manual retry.

Lease acquisition marks the worker `running` with the current job and lease ids.
Completion, failure, cancellation, and stale lease expiry return the worker to
`idle`; explicit heartbeats can mark it `offline` or refresh status text and
metadata. This is the agent-facing control surface for “who is doing what right
now?” without requiring process inspection.

The inline client implements the same lifecycle in memory for tests and small
embedders, including automatic requeue and manual retry behavior.

## REST and SSE Facade

`createGatewayRestServer()` wraps any `GatewayClient` with a dependency-free
local HTTP surface. `createGatewayRestClient()` gives apps, external adapters,
and UI code the same typed facade over that route surface. REST does not replace
Rust IPC; it sits above the client so the same route contracts work with inline
tests or the Rust daemon.

```ts
import {
  createGatewayRestClient,
  createGatewayRestServer,
  RustGatewayClient,
} from '@snapdragon-ai/gateway';

const gateway = new RustGatewayClient({ socketPath: '/tmp/snapdragon-gateway.sock' });
const rest = createGatewayRestServer(gateway);
const baseUrl = await rest.listen();
console.log(baseUrl); // http://127.0.0.1:<port>/v1

const remote = createGatewayRestClient(baseUrl);
const lease = await remote.acquireJob('default', 'pi-worker-1');
if (lease) await remote.completeJob(lease.job.id, { ok: true });
```

From `sd`, the same facade can be started as an operator command:

```sh
sd gateway rest serve --start --port 8787
```

Initial routes cover:

- `GET /v1/health`, `GET /v1/status`, and `GET /v1/world`.
- `GET /v1/stream` for typed Server-Sent Events snapshots, heartbeats, and
  gateway-side stream errors.
- `GET /v1/services`, `POST /v1/services/:name/run`, and
  `POST /v1/services/:name/enable`.
- `GET /v1/agents`, `POST /v1/agents/probe`, `POST /v1/agents/probe/pi`,
  `POST /v1/agents/register`, `GET /v1/agents/:id`, `DELETE /v1/agents/:id`,
  and `POST /v1/agents/:id/unregister`.
- `GET /v1/workers`, `POST /v1/workers`, `GET /v1/workers/:id`,
  `POST /v1/workers/:id/heartbeat`, `DELETE /v1/workers/:id`,
  `POST /v1/workers/:id/unregister`, and `GET /v1/worker-processes`.
- `GET /v1/jobs`, `POST /v1/jobs`, `GET /v1/jobs/:id`,
  `POST /v1/jobs/acquire`, `DELETE /v1/jobs/:id`,
  `POST /v1/jobs/:id/cancel`, `POST /v1/jobs/:id/complete`,
  `POST /v1/jobs/:id/fail`, and `POST /v1/jobs/:id/retry`.
- `GET /v1/events`, `POST /v1/events`, `GET /v1/events/:id`,
  `DELETE /v1/events/:id`, `POST /v1/events/:id/cancel`, `GET /v1/logs`,
  `POST /v1/logs`, `GET /v1/registry`,
  `GET /v1/capabilities`, `GET /v1/sandboxes`, `POST /v1/sandboxes`,
  `GET /v1/sandboxes/:id`, and `POST /v1/sandboxes/:id/release`.

World snapshots include active sandbox leases alongside jobs, events, logs,
services, durable worker records, worker process diagnostics, runtimes,
capabilities, queue depths, and tables.
`gateway.worldSnapshot(options)`, `GET /v1/world`, and `GET /v1/stream` share a
focused projection vocabulary for UI and agent reads. Callers can request
sections such as `jobs,logs,workers` and filter by target job, queue, runtime,
service, worker, capability, state, kind, log limit, or table names without
changing the response shape. Unrequested sections return empty collections while
`status`, `runtime`, and `capturedAtMs` remain available for liveness.
Runtime probe routes are non-mutating; management surfaces can test Pi's JSONL
RPC health and inspect the returned descriptor before deciding whether to call
the durable register route.
REST worker lifecycle routes let external adapters claim work, report progress
through logs, finish successfully, fail clearly, and keep the same worker/job
state visible to dashboards and executive agents.
Cancellation routes return the cancelled record when they succeed and a 404
error body when the target job or event is unknown, so agent scripts can treat
cleanup as an observable state transition instead of a silent no-op.

The default listener binds to `127.0.0.1`. Authentication, policy enforcement,
and remote exposure are later layers on the same route shape.

## Sandbox Contracts

`GatewaySandboxSpec` and `GatewaySandboxLease` describe project-scoped execution
spaces without baking in a backend. The first `sd` backend is local git
worktrees with optional linked reference roots; richer providers such as
OpenShell, Docker, microVMs, or remote sandboxes should implement the same lease
shape instead of coupling callers to a specific runtime.

The inline facade keeps leases in memory for tests. The Rust daemon persists
leases in the gateway store, exposes them over IPC, and serves the same shape
through REST so UIs, external runtimes, and executive agents can inspect and
release sandboxes without scanning local lease files.

## Observability

`gateway.status()` exposes the operator snapshot used by `sd gateway status`:
registered service tasks, queue depths, active leases, recent failures, tables,
process count, worker process snapshots, pid, and uptime. `worldSnapshot()` adds
durable worker records so dashboards and agents can inspect registered workers,
heartbeats, current leases, and runtime metadata in one shape. Focused snapshot
options let long-running agents poll only the world sections they need while
retaining the same typed shape as the full dashboard snapshot. Service workers
are spawned with explicit timeout enforcement, so budget expiry kills the child
process and records a `timed_out` worker process state. The daemon also expires
stale job leases during status/watchdog passes so stuck jobs can become visible
and recoverable without requiring a foreground TUI process.
Stale or retired runtimes and workers can be unregistered through the client,
REST facade, or IPC, which keeps management surfaces clean without deleting job,
log, or process history.

## Current Boundaries

This package defines local-first gateway contracts. Distributed transport
interfaces are part of the design direction, but Iroh clustering, appliance UI
assets, and full remote service routing are later layers.
