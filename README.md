# Snapdragon

Snapdragon is a local-first agent orchestration runtime. It started as an
experiment in applying an ECS (Entity Component System) pattern to a single
agent loop, and that pattern remains the core idea: state is held in components,
behavior is applied by systems, and a small reducer keeps mutation explicit.

The architecture now has two ECS layers:

- The single-agent ECS loop powers embedded workers. Memory, context, provider
  calls, tool execution, sessions, and run events follow the same component and
  system pattern inside one focused agent run.
- The gateway ECS world powers orchestration. Agents, workers, services, jobs,
  channels, sessions, capabilities, sandboxes, approvals, and projects are
  durable runtime entities driven by schedulers, supervisors, dispatchers,
  policy systems, and executive agents.

Rust owns the durable gateway runtime: queues, leases, service supervision,
worker processes, local IPC, SQLite-backed state, and future WASM isolation. The
TypeScript/JavaScript packages remain npm-installable facades for apps,
adapters, plugins, tests, web UI surfaces, and embedded use. `sd` is the
batteries-included Snapdragon client and built-in worker, not the boundary of
the system.

## Packages

| Package | Purpose |
| --- | --- |
| `@snapdragon-ai/core` | Bundle, signature, schedule, and component-facing types. |
| `@snapdragon-ai/host` | Capability registry and streaming provider adapters. |
| `@snapdragon-ai/ui` | Renderer-neutral UI ECS descriptors and state. |
| `@snapdragon-ai/content` | Side-effect-free contracts for skills, memory, profiles, and extensions. |
| `@snapdragon-ai/gateway` | Gateway contracts, Rust client, inline harness, world snapshots, and REST/SSE facade. |
| `@snapdragon-ai/learn` | Learning, eval, rollout, rubric, and training job contracts. |
| `@snapdragon-ai/session` | Portable append-only JSONL sessions. |
| `@snapdragon-ai/config` | Side-effect-free resolved config contracts. |
| `@snapdragon-ai/tools` | Tool registry, coding tools, and the REPL toolset. |
| `@snapdragon-ai/agent` | Embeddable chat/coding agent loop. |
| `@snapdragon-ai/sd` | Batteries included TUI agent for me to test, and use to develop itself! |
| `@snapdragon-ai/repl` | Minimal CLI for the default coding REPL agent. |

## Gateway

Snapdragon's gateway is the main orchestration substrate for background work,
service scheduling, multi-agent jobs, channels, external agent runtimes, and
future appliance-style extensions. The default runtime is Rust
(`crates/gateway-daemon`) with a TypeScript facade in `@snapdragon-ai/gateway`;
tests and embedded hosts can still use the inline TypeScript harness.

`sd` is only one consumer of the gateway. Its background services and agent-job
workers run as headless worker processes, so scheduled memory, skill,
session-index, channel-event, learn, and agent work can reuse `sd` config,
profiles, extensions, stores, and providers without starting the Ink TUI or the
interactive agent shell.

```bash
sd gateway start
sd gateway status
sd gateway inspect job_123 --runtime pi
sd gateway rest serve --port 8787
sd gateway services list
sd gateway services run session-index
sd gateway channels ensure local:demo
sd gateway events enqueue local:demo "summarize this channel"
sd gateway stop
```

Current gateway state is local-first. The Rust crates already model mailboxes,
registry entries, service specs, ETS-like tables, links, monitors, supervision
types, agent runtime descriptors, durable jobs, leases, logs, and Wasmtime
budget exits. The npm facade can register external runtimes such as `sd`,
Codex, Hermes Agent, Pi Agent, or custom workers; it also exposes world
snapshots and a dependency-free local REST/SSE facade for integration and UI
work. `sd gateway rest serve` exposes that facade on a loopback address for
local UI previews and external adapters. Distributed clustering and Iroh
transport are intentionally deferred until local semantics are solid.

## sd Extensions

`sd` discovers local extensions from `snapdragon.extension.yaml`, `.yml`, or `.json`
manifests under `~/.snapdragon/sd/extensions` and profile-local `extensions/`
directories. Discovery reads descriptors only; executable extension code is loaded
only during activation for enabled extensions.

Extensions can contribute descriptor-only skill roots through the manifest, and
trusted local modules can register toolsets, provider factories, and memory
providers through the activation context. Runtime reload is available with
`/extensions reload`, using the configured hot-reload mode.

## Layout

```text
packages/
  core/
  host/
  gateway/
  learn/
  session/
  config/
  tools/
  agent/
  sd/
  repl/
crates/
  core/
  gateway-core/
  gateway-daemon/
  gateway-wasm/
examples/
  basic-agent/
  coding-repl/
docs/
wit/
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

The Rust kernel builds to `wasm32-wasip2`; install that target with rustup before running the full build if it is missing.

# Examples Roadmap
