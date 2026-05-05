# Architecture

Snapdragon is split into a small portable kernel and host-side SDK packages.

- `crates/core` contains the Rust/WASI component runtime primitives.
- `packages/core` exposes bundle and schedule types for JavaScript users.
- `packages/host` owns provider adapters and capability dispatch.
- `packages/session` owns portable append-only JSONL sessions.
- `packages/config` owns resolved config contracts and normalization helpers.
- `packages/tools` owns the tool registry plus coding and REPL tools.
- `packages/agent` composes providers and tools into an embeddable loop.
- `packages/gateway` exposes gateway client contracts, an inline harness, and
  Rust daemon IPC bindings.
- `packages/learn` defines learning, evaluation, rollout, rubric, and training
  job contracts.
- `packages/repl` ships the default command-line agent.

The first public release keeps the default experience small: chat, coding tools, and a REPL tool that can inspect and call the registered tool surface programmatically.

## Gateway Runtime

The gateway is the runtime substrate for work that should not be tied to the
interactive `sd` TUI. It is Rust-first, with TypeScript contracts layered on top:

- `crates/gateway-core` contains actor ids, envelopes, mailboxes, selective
  receive filters, registry state, service specs, links, monitors, supervision
  types, transport traits, and ETS-like table primitives.
- `crates/gateway-daemon` runs the Tokio daemon, local IPC server, service
  scheduler, worker process launcher, and status surface.
- `crates/gateway-wasm` is the Wasmtime budget boundary for future sandboxed
  kernels and extension work.
- `packages/gateway` is the JavaScript facade used by `sd`, extensions, tests,
  and future embedders.

`sd` registers gateway services from resolved config. In Rust mode those
services run through headless worker commands that rebuild only the background
runtime pieces they need, instead of loading Ink or the full interactive CLI.
This keeps command-only paths such as help, status, and service runs from
accidentally paying the TUI/runtime cost.

The local gateway already has enough structure for scheduled memory, skill,
session-index, and channel-event services. Iroh clustering, appliance resource
routing, richer supervision policies, and learn/RL process management are next
layers on the same contracts, not responsibilities of `sd` itself.
