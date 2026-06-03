# Gateway Orchestration

Snapdragon has two ECS layers. The embedded agent loop keeps one run small and
composable. The gateway ECS world drives many entities asynchronously: agents,
workers, services, jobs, channels, sessions, capabilities, sandboxes, approvals,
and projects.

## Entities, Components, and Systems

The gateway should expose concrete nouns to users and agents while preserving an
ECS-shaped implementation internally.

| Gateway noun | ECS role | Common components |
| --- | --- | --- |
| Agent runtime | Entity | kind, protocol, command/RPC endpoint, supported jobs, capabilities, health |
| Worker | Entity | registered worker record, queue, runtime id, service, capabilities, heartbeat, current job, current lease |
| Job | Entity | spec, state, queue, priority, attempts, parentage, routing hints |
| Service | Entity | schedule, enabled state, restart policy, budget, worker command |
| Channel | Entity | target, event queue, subscribers, session refs |
| Sandbox | Entity | backend, cwd, project ref, lease expiry, reference roots |
| Capability | Component | provider actors, scopes, policy hints |
| Project | Entity | root, branch, config, policy defaults |

Systems act when entities match their conditions:

- Scheduler systems enqueue due service runs and event work.
- Lease systems acquire pending jobs, expire stale leases, and release failed
  workers back to idle.
- Worker registry systems validate registrations, record heartbeats, and keep
  current leases visible to agents and dashboards.
- Sandbox lease systems record project-scoped execution spaces, expose active
  leases in world snapshots, and release or hide expired sandboxes.
- Dispatch systems route jobs to matching agent runtimes or native services.
- Supervisor systems restart transient workers and suppress restart storms.
- Policy systems evaluate scopes, approvals, sandbox requirements, and future
  auth decisions.
- Log and projection systems build inspectable snapshots for CLI, REST, SSE,
  and UI.
- Executive-agent systems decompose goals, enqueue child jobs, watch status, and
  update plan artifacts.

```mermaid
flowchart TB
  World["Gateway ECS world"]
  World --> Jobs["Job entities"]
  World --> Agents["Agent runtime entities"]
  World --> Workers["Worker entities"]
  World --> Services["Service entities"]
  Jobs --> Scheduler["Scheduler and lease systems"]
  Agents --> Dispatcher["Dispatch system"]
  Workers --> Supervisor["Supervisor system"]
  Services --> Scheduler
  Scheduler --> Logs["Logs and world snapshots"]
  Dispatcher --> Logs
  Supervisor --> Logs
```

## Job and Event Lifecycle

Durable jobs are the canonical unit of work. Events remain useful as signals and
audit records, but actionable event work should eventually become leaseable jobs
or use equivalent acquire/complete/fail semantics.

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> running: acquire lease
  running --> completed: complete
  running --> pending: fail with attempts left
  running --> failed: fail with no attempts left
  running --> pending: lease expires with attempts left
  running --> failed: lease expires with no attempts left
  pending --> cancelled: cancel
  running --> cancelled: cancel
  failed --> pending: manual retry
  completed --> [*]
  failed --> [*]
  cancelled --> [*]
```

Every job should have enough context for agent experience: kind, queue, payload,
priority, parent job id, correlation id, target runtime id, project/channel refs,
sandbox lease, policy hints, attempts, last error, result, and logs.

Every worker should have enough context for orchestration experience: stable id,
queue, runtime id, service name when applicable, capabilities, heartbeat time,
state, current job id, current lease id, lease expiry, status text, last error,
and adapter metadata. Lease acquisition auto-creates a minimal worker record when
an ad-hoc adapter has not registered first, but managed runtimes should register
and heartbeat explicitly so their control surface is descriptive.

Sandbox leases are gateway entities, not local implementation details. The
first local backend records `git worktree` leases with cwd, project ref, branch,
TTL, and reference roots. The Rust gateway stores the active lease registry and
serves it through IPC, REST, SSE world snapshots, and the TypeScript facade, so
agents can ask "where am I allowed to work?" without hunting through files.

## Agent Runtime Registration

Agent runtimes are registered descriptors, not hardcoded integrations. The first
descriptor fields are:

- `id`, `kind`, and `protocol`.
- optional command spec or future RPC endpoint metadata.
- supported job kinds and declared capabilities.
- isolation preference such as inherit, profile, channel, or sandbox.
- health and metadata for dashboards and routing.

`sd` should register as the built-in runtime. Pi Agent is the first concrete
external adapter: Snapdragon registers a `kind: "pi"`, `protocol: "jsonl"`
descriptor and launches `pi --mode rpc` as a worker runtime. Codex, Hermes
Agent, and custom workers should use the same descriptor model through command,
JSONL, stdio, HTTP, or embedded protocols.

The Rust gateway persists registered runtime descriptors in its durable store.
The `sd` facade can also save descriptors under `gateway.agent_runtimes`; saved
descriptors are visible in `sd gateway agents list/show` even before the daemon
is available, and job workers can re-register them before dispatch. This gives
operators one stable setup step instead of a hidden in-memory runtime table.

Worker records are also durable. Runtime registration answers "what kind of
agent can be invoked?" while worker registration answers "which concrete worker
is available or currently holding work?" Pi, Codex, Hermes, `sd`, and custom
adapters can all use the same `workers.register`, `workers.heartbeat`, and job
lease flow.

```mermaid
sequenceDiagram
  participant Gateway
  participant Worker as "agent-jobs service"
  participant Pi as "pi --mode rpc"
  Gateway->>Worker: lease agent.run targetRuntimeId=pi
  Worker->>Gateway: append log agent runtime started
  Worker->>Pi: spawn JSONL RPC process
  Worker->>Pi: prompt
  Pi-->>Worker: message_update and extension_ui_request
  Worker->>Gateway: append selected Pi runtime events as job logs
  Worker-->>Pi: extension_ui_response cancelled
  Pi-->>Worker: message_end and agent_end
  Worker-->>Gateway: complete job with summary, content, metrics
```

While a runtime job is active, the worker polls the durable job record. If an
operator or executive agent cancels the job through IPC, REST, or CLI, the
worker aborts the runtime signal and the Pi adapter sends an RPC `abort` before
stopping the child process. Cancelled jobs are terminal: late completion or
failure writes from a worker return the cancelled record instead of resurrecting
the job.

## Executive Agents

Executive agents are ordinary orchestrator participants. They read a goal and
world snapshot, write a plan, enqueue child jobs, observe logs and status, then
revise or cancel work. This keeps organizational hierarchy visible and
revocable.

```mermaid
sequenceDiagram
  participant User
  participant Exec as "Executive agent"
  participant Gateway
  participant Worker as "Worker agent"
  User->>Gateway: enqueue goal job
  Gateway->>Exec: lease executive job
  Exec->>Gateway: enqueue child jobs
  Worker->>Gateway: acquire child job
  Worker-->>Gateway: complete child job
  Exec->>Gateway: observe snapshot and logs
  Exec-->>Gateway: complete goal with plan artifact
```

## Supervision and Failure Modes

Failures should be explicit and inspectable:

- A crashed worker records process state, last error, and recent logs.
- A timed-out worker is killed by the daemon and recorded as `timed_out`.
- A registered worker that has not failed can heartbeat itself `offline`, which
  keeps it inspectable without advertising that it is ready for work.
- A worker-reported failure requeues the job while attempts remain, then marks
  it failed once attempts are exhausted.
- A stale lease expires during watchdog/status passes and follows the same
  attempt-aware retry or failure path.
- Manual retry requeues failed jobs for operator or executive-agent recovery
  without clearing the attempt history or last error.
- Retry decisions are controlled by job attempts and service restart intensity.
- Cancellation updates the durable record, removes active leases, aborts
  cooperative runtime workers, and stops future dispatch.
- Policy or approval blocks should be represented as state, not hidden logs.

## AX Expectations

The gateway is for agents as much as humans. A good control surface should make
the next action obvious:

- One path to enqueue, inspect, cancel, and retry jobs.
- Stable ids and correlation ids across jobs, events, logs, and artifacts.
- World snapshots that explain queue depth, active leases, workers, runtimes,
  and recent failures.
- SSE streams publish typed snapshot, heartbeat, and error envelopes with
  sequence ids, so quiet gateways, broken streams, and failed snapshot reads are
  distinguishable without scraping logs.
- Cancellation routes return concrete records or explicit 404s, so agents do
  not mistake a no-op for successful cleanup.
- Workers can register, heartbeat, show their current lease, unregister stale
  identities, report progress in logs, fail clearly, and be cancelled without
  hidden state or manual file hunting.
- Agent runtimes can be registered, inspected, and unregistered with durable
  effects so management surfaces do not accumulate stale adapters.
- Concrete public nouns: jobs, services, agents, workers, capabilities, events,
  logs, sandboxes.
- ECS terminology stays in architecture docs and implementation internals unless
  the caller is building gateway systems directly.
