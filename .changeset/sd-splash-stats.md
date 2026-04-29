---
'@snapdragon-ai/sd': minor
---

Add a stats panel to the right of the splash dragon — counts of
loaded tools, skills, profiles, background services, and extensions,
plus a snapshot of the agent's reasoning effort and token budgets.

Counts come from a new `runtimeStats(runtime)` helper in
`packages/sd/src/tui/ui.ts` that walks the runtime's existing
sync surfaces:

- `tools` from `runtime.agent.registry.listDefinitions()`
- `skills` from `runtime.skills.list()`
- `profiles` from `runtime.profileStore.list()`
- `services` from `runtime.background.list()`
- `extensions` from `runtime.extensions.list()`
- `reasoning`, `contextTokens`, `outputTokens` from `runtime.config.agent`

The stats are recomputed on every `refreshRuntimeStatus()` call so
they stay current after `/skills reload`, profile switches, etc.

Token counts render in a compact `K`/`M` form (`400K`, `32K`).
