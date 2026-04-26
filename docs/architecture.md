# Architecture

Snapdragon is split into a small portable kernel and host-side SDK packages.

- `crates/core` contains the Rust/WASI component runtime primitives.
- `packages/core` exposes bundle and schedule types for JavaScript users.
- `packages/host` owns provider adapters and capability dispatch.
- `packages/tools` owns the tool registry plus coding and REPL tools.
- `packages/agent` composes providers and tools into an embeddable loop.
- `packages/repl` ships the default command-line agent.

The first public release keeps the default experience small: chat, coding tools, and a REPL tool that can inspect and call the registered tool surface programmatically.
