---
'@snapdragon-ai/host': minor
'@snapdragon-ai/sd': minor
---

A handful of fixes and cleanups across `host` and `sd`.

**Anthropic reasoning fix.** Adaptive-thinking-capable Claude models
(Opus 4.7, Opus 4.6, Sonnet 4.6, mythos-preview) now use the
`thinking: { type: 'adaptive', display: 'summarized' }` body shape
with an `output_config.effort` field, instead of the older fixed
`budget_tokens` form which doesn't behave well on those models.
Older Claude models still get `thinking: { type: 'enabled',
budget_tokens }` as before. New `xhigh` value is added to the
`ReasoningRequest.effort` enum for the new effort tier.

**`agent.reasoning` is now deep-merged.** The new
`mergeAgentConfig` helper in `packages/sd/src/agent-config.ts` deep
merges both `agent.context` and `agent.reasoning`, so users can
override individual reasoning fields (e.g.
`agent.reasoning.effort: high`) without having to repeat the rest of
the default block.

**Config path fallback.** `loadSdConfig` now falls back to a legacy
root config path when the default path is absent, easing migration
for users with older configs.

**TUI completion catalog refactor.** Splits the TUI input
completion sources into per-source modules
(`completion-catalog-{providers,sessions,profiles,profile-description,skills}.ts`),
fronted by a small `completion-catalog.ts`. `input-controller.ts`
shrinks substantially as a result.

**TUI rendering helpers.** New
`provider-event-buffer.ts` coalesces provider stream deltas before
publishing UI snapshots (smoother streaming, less churn in the chat
component). New `transcript-viewport.ts` extracts a lazy
bottom-selection routine that matches the full wrapped output.
`ui.ts` types (`ChatEntry`, `ToolEntry`) move into
`packages/sd/src/tui/ui-entry.ts`. `prompt-completion-json.ts`
extracts the JSON projection of completion state.

Tests cover the adaptive-thinking branch, the legacy-thinking
branch, the legacy config path fallback, the provider-event
coalescer, and the lazy viewport. No public API removals.
