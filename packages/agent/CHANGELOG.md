# @snapdragon-ai/agent

## 0.2.0

### Minor Changes

- 3e01d51: Add the TypeScript foundation for provider-neutral multimodal content, provider
  adapters, portable JSONL sessions, config contracts, toolset filtering, and
  session-aware agents.
- d919cbb: Add the minimal sd coding REPL with env-backed config, provider wiring,
  portable sessions, image attachments, and streamed agent events.
- b6b6058: Add append-only JSONL context chunks, deterministic fresh-tail context assembly, and automatic agent-side session compaction. `sd` now enables conservative context windowing by default under `agent.context` while keeping canonical session messages lossless.

### Patch Changes

- e9954ec: Fix the empty-content error event firing for reasoning-enabled runs.

  The previous heuristic was:

  ```ts
  if (isEmptyContent(response.content) && !response.thinking?.length)
  ```

  i.e. "only emit the error when both content **and** thinking are
  empty". With `agent.reasoning` enabled by default (Anthropic adaptive
  thinking), the dominant failure mode is **content empty, thinking
  present** — the model thinks through the prompt and then bails before
  producing any final text. The original heuristic explicitly excluded
  that path, which is why users kept seeing silent `(empty)` rows even
  after the prior PR shipped.

  The check now fires on empty content alone, regardless of thinking.
  The error message also splits into two variants so reasoning-only
  failures are clearly labelled:

  > `provider returned only reasoning, no final content
(finish_reason=end_turn); the model thought through the prompt but
bailed before producing text — try rephrasing or disabling
reasoning`

- 89ef7d8: Surface provider stream errors so they stop disappearing as `(empty)`
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

- 06f11a6: Add sd session resume/list/delete UX plus profile overlays for provider, model, agent, persona, and toolset settings.
- 3153bfc: Add descriptor-first skill contracts, generic skill tools, one-request sd skill commands, profile-local skill/session homes, memory provider contracts, Markdown memory tools, first-party skills/profile templates, and extension manifest discovery.
- Updated dependencies [3e01d51]
- Updated dependencies [06f11a6]
- Updated dependencies [733ef06]
- Updated dependencies [89ef7d8]
- Updated dependencies [3153bfc]
- Updated dependencies [b6b6058]
  - @snapdragon-ai/host@0.2.0
  - @snapdragon-ai/session@0.2.0
  - @snapdragon-ai/tools@0.2.0

## 0.1.1

### Patch Changes

- @snapdragon-ai/host@0.1.1
- @snapdragon-ai/tools@0.1.1
