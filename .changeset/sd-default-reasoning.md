---
'@snapdragon-ai/sd': minor
---

Enable extended thinking by default. `defaultSdConfig()` now sets
`agent.reasoning = { enabled: true, effort: 'medium' }`, so reasoning
deltas flow through the existing `thinking` event pipeline and render
in the TUI transcript as `o ` rows (the most recent line shimmers
while streaming, courtesy of #18).

User configs that explicitly set `agent.reasoning.enabled: false` or
override `effort` will continue to take precedence — the merge layer
treats `agent.reasoning` as a flat replacement, not a deep merge, so
opting out is a single key flip.
