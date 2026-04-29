---
'@snapdragon-ai/host': patch
'@snapdragon-ai/agent': patch
'@snapdragon-ai/sd': patch
---

Surface provider stream errors so they stop disappearing as `(empty)`
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
