# Snapdragon

Inspired by the simplicity, versatility and self modification capabilities of [pi](https://github.com/badlogic/pi-mono) and the power, self-learning and memory of [hermes-agent](https://github.com/nousresearch/hermes-agent), among many other great agents, I wanted to make my own to learn about how they work and try some ideas out

Instead of the normal agent loop, the ehart of Snapdragon is most similar to an ECS (Entity Component System) commonly used in games. Everything from tools, to memory, to context - everything is a Component and/or System. There's really only 1 Entity, and instead of the normal tick driving everything, the cadence is set by tools and calls to providers to get model responses (yes, providers are also registered the same way!) I think this will make it extremely versatile, and with dynamic registration, agents will be able to hot reload themselves with new tools and plugins constantly

The core is in Rust, so I can work on optimising the ECS system as much as possible, and support things like in-process agent delegation easily (for things like RLM with a lot of recursion - no heavy subprocesses if I can avoid it). Right now it's compiled to WASM, so it's extremely portable, and will make it easy to run anywhere. The idea is, any host that can run WASM, can provide whatever components and systems are needed. So it should work on edge devices, in the browser, embedded in other languages, whatever. I'll add examples of this as I get to it!

## Packages

| Package | Purpose |
| --- | --- |
| `@snapdragon-ai/core` | Bundle, signature, schedule, and component-facing types. |
| `@snapdragon-ai/host` | Capability registry and streaming provider adapters. |
| `@snapdragon-ai/ui` | Renderer-neutral UI ECS descriptors and state. |
| `@snapdragon-ai/content` | Side-effect-free contracts for skills, memory, profiles, and extensions. |
| `@snapdragon-ai/session` | Portable append-only JSONL sessions. |
| `@snapdragon-ai/config` | Side-effect-free resolved config contracts. |
| `@snapdragon-ai/tools` | Tool registry, coding tools, and the REPL toolset. |
| `@snapdragon-ai/agent` | Embeddable chat/coding agent loop. |
| `@snapdragon-ai/sd` | Batteries included TUI agent for me to test, and use to develop itself! |
| `@snapdragon-ai/repl` | Minimal CLI for the default coding REPL agent. |

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
  session/
  config/
  tools/
  agent/
  sd/
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

# Examples Roadmap
