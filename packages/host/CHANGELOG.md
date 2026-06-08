# @snapdragon-ai/host

## 0.2.0

### Minor Changes

- 36943c9: Add the TypeScript foundation for provider-neutral multimodal content, provider
  adapters, portable JSONL sessions, config contracts, toolset filtering, and
  session-aware agents.
- 4d7a6a1: Add provider-level model discovery, OpenAI Codex OAuth helpers, static Codex
  model catalogue, and Responses-native image generation tool support.
- e3ad840: A handful of fixes and cleanups across `host` and `sd`.

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

### Patch Changes

- e786135: Surface provider stream errors so they stop disappearing as `(empty)`
  assistant rows.

  **Anthropic SSE handler** (`packages/host/src/providers/anthropic-stream.ts`):

  - Mid-stream `error` events from Anthropic (`overloaded_error`,
    `api_error`, content-policy hits, etc.) were being silently dropped
    by the for-await loop. They now throw with the upstream error type
    and message attached.
  - Streams that drain without ever emitting a `message_delta` (i.e.
    no stop reason — usually a connection drop) now throw rather than
    returning a partial response.

  **Agent** (`packages/agent/src/index.ts`):

  - When the provider returns empty content with no tool calls and no
    thinking, the agent now emits a `provider_event` of `kind: 'error'`
    describing the situation (including the upstream `finish_reason`).
    The previous behaviour was a silent return, which surfaced as an
    unexplained `(empty)` chat row.

  **SD UI** (`packages/sd/src/tui/ui.ts`):

  - Provider error events now produce an inline chat row (role:
    `error`, red prefix) in addition to the event-log entry. You no
    longer have to flip the events panel open to see why a turn
    produced no content.

  Tests cover the SSE error event branch, the missing-stop-reason
  branch, and both the empty-content-no-tool-calls and
  empty-content-with-tool-calls agent paths.

  - @snapdragon-ai/core@0.2.0

## 0.1.1

### Patch Changes

- @snapdragon-ai/core@0.1.1
