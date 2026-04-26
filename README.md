# Snapdragon

Small, portable agent runtime components for building coding and tool-using agents.

This repository is a clean-history monorepo for the public `@snapdragon-ai` packages. It carries forward the kernel and SDK ideas from the prototype repo while keeping the first public shape focused on a compact library, a default coding REPL agent, and small examples.

## Packages

| Package | Purpose |
| --- | --- |
| `@snapdragon-ai/core` | Bundle, signature, schedule, and component-facing types. |
| `@snapdragon-ai/host` | Capability registry and streaming provider adapters. |
| `@snapdragon-ai/tools` | Tool registry, coding tools, and the REPL toolset. |
| `@snapdragon-ai/agent` | Embeddable chat/coding agent loop. |
| `@snapdragon-ai/repl` | Minimal CLI for the default coding REPL agent. |

## Layout

```text
packages/
  core/
  host/
  tools/
  agent/
  repl/
crates/
  core/
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
