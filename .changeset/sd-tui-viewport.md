---
'@snapdragon-ai/sd': minor
---

TUI viewport wrapping, tool-result rendering, and per-event detail.

- New `wrapTranscriptRows` (in `packages/sd/src/tui/transcript-wrap.ts`)
  hard-wraps transcript rows to the available viewport columns *before*
  the bottom-of-viewport selection, so long lines no longer escape the
  chat box and the visible region always shows the most recent rows.
  `SdTuiApp` threads `viewportColumns` through the renderer registry
  and reserves space for the side panel when it is visible.
- Tool results now render inline in the transcript as their own role
  (`+ done read_file`, body lines, `+ full output in events`) via the
  new `transcript-tool-rows.ts` module, instead of disappearing into the
  event log only.
- Within a single agent run, intermediate "checking..." style assistant
  text is now superseded by the final answer (one assistant entry per
  run), while tool calls remain visible as their own entries. Stream
  text accumulates in `#providerTurnText` and is reset per provider
  start so multi-segment streams compose correctly.
- Event log entries now carry a `detail` field; tool-end events
  include a short body excerpt directly under the headline so you can
  see what a tool produced without leaving the main view.
