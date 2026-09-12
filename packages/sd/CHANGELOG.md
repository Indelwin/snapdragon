# @snapdragon-ai/sd

## 0.2.0

### Minor Changes

- 20a9375: Add gateway job retry controls. Failed jobs with attempts remaining requeue
  automatically, terminal failed jobs can be retried through the TypeScript
  client, Rust IPC, REST, and `sd gateway jobs retry`, while cancelled jobs remain
  terminal.
- 20a9375: Add gateway-managed sandbox lease registration. Sandbox leases are now part of
  the TypeScript client, Rust IPC daemon store, world snapshots, REST routes, and
  `sd gateway sandboxes` daemon sync path so management UIs and agents can inspect
  local worktree ownership before the UI layer lands.
- ef36464: Persist gateway agent runtime descriptors and let `sd gateway agents register-pi --save` reuse saved Pi runtimes.
- 0b3e66e: Add a Pi JSONL RPC runtime adapter and route gateway agent jobs to registered Pi runtimes.
- 733ef06: A handful of fixes and cleanups across `host` and `sd`.

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

- b3b4d10: Replace the bold `SNAPDRAGON` text in the splash banner with a big
  figlet-rendered ASCII title in a vertical pink → lilac gradient.

  The new `<AsciiTitle>` component (`packages/sd/src/tui/renderers/
ascii-title.tsx`) wraps `figlet` directly and renders the result one
  `<Text>` per line, with each line painted by linearly interpolating
  across the supplied colour stops. Defaults to `Standard` font; the
  splash uses `Slant` for a chunky, slightly italic look.

  Skips the `ink-ascii` package — it's pinned to `ink ^2.6.0 / react
^16.12.0` and won't compose with our ink 7 / react 19 stack — but
  it was just a thin wrapper around figlet anyway, so we're using
  figlet directly.

  Adds `figlet` and `@types/figlet` as dependencies.

- 852ac00: Add an `sd` background services gateway that owns the lifecycle, scheduling, and status surface for in-process workers. The existing memory worker is now registered as one such service (via `memoryWorkerService()`), and a placeholder `skillBuilderService()` is wired in for the upcoming auto skill builder. Adds a `--noBackground` runtime option that disables every background service in one shot; the legacy `--noMemoryWorker` keeps working and only disables that one service. Public API: `startSdBackgroundServices`, `defaultSdBackgroundServices`, `SdBackgroundService`, `SdBackgroundServicesHandle`, and `SdBackgroundServiceStatus`.
- 0d1f72e: Add `/paste` for attaching clipboard content from inside `sd`.

  - Pasting an image (e.g. screenshot) writes a content-addressed PNG into a
    per-session attachments dir (`<session-root>/<session-id>.attachments/`)
    and queues it as a `PendingAttachment` on the next prompt.
  - Pasting text (or `/paste text`) echoes the clipboard's text contents
    back so you can copy a section into your prompt.
  - macOS only for now (uses `osascript` for images, `pbpaste` for text);
    other platforms get a clear error message rather than a silent failure.

- c83796d: Enable extended thinking by default. `defaultSdConfig()` now sets
  `agent.reasoning = { enabled: true, effort: 'medium' }`, so reasoning
  deltas flow through the existing `thinking` event pipeline and render
  in the TUI transcript as `o ` rows (the most recent line shimmers
  while streaming, courtesy of #18).

  User configs that explicitly set `agent.reasoning.enabled: false` or
  override `effort` will continue to take precedence — the merge layer
  treats `agent.reasoning` as a flat replacement, not a deep merge, so
  opting out is a single key flip.

- 06f11a6: Add renderer-neutral UI ECS primitives and wire sd for ECS-backed TUI mode while
  preserving the embeddable REPL mode.
- 5da6090: Add `sd` extension activation for trusted local modules that can register toolsets, provider factories, memory providers, and skill roots, with descriptor-only manifest discovery and runtime reload support.
- 20a9375: Add `sd gateway inspect` for focused pre-UI inspection of gateway jobs, workers,
  runtimes, services, leases, sandboxes, and recent logs.
- 20a9375: Add `sd gateway rest serve` for running the local REST/SSE facade over the Rust gateway.
- 20a9375: Register and heartbeat the built-in `agent-jobs` and `learn-jobs` gateway
  workers so `sd` exposes idle, running, completed, cancelled, and failed job
  worker state through the gateway worker registry before UI work.
- d919cbb: Add the minimal sd coding REPL with env-backed config, provider wiring,
  portable sessions, image attachments, and streamed agent events.
- 06f11a6: Add sd session resume/list/delete UX plus profile overlays for provider, model, agent, persona, and toolset settings.
- 3153bfc: Add descriptor-first skill contracts, generic skill tools, one-request sd skill commands, profile-local skill/session homes, memory provider contracts, Markdown memory tools, first-party skills/profile templates, and extension manifest discovery.
- 0cc0fe1: Add a running indicator with a breathing-pink spinner and a "shimmer"
  animation for the thinking placeholder and the latest reasoning line.

  While a run is active, the prompt footer now shows
  `<spinner> <Thinking|Connecting|Streaming|Running tool>...` instead of
  the empty-cursor we used to show. The phase is derived from existing
  provider events (`started`, `thinking`, `text`, `tool_call_start`) so
  no new wire-format is needed; provider-extension authors get the
  indicator for free.

  Reasoning rows in the transcript now shimmer on the most recent line
  while the entry is streaming, then go calm once the run ends. Note
  that reasoning blocks only appear when a model is configured with
  `agent.reasoning` (or per-provider `reasoning`) — by default, no
  reasoning is requested, so no `o ` lines render. Configure
  `reasoning.{enabled: true, effort: 'medium'}` in your `sd` config to
  see them.

  The new effects live in `packages/sd/src/tui/renderers/effects.tsx`
  and own their own animation timers (cleared on unmount), so they're
  zero-deps and safe to drop into any Ink tree.

- 15b2e08: Add support for a custom `splash.png` rendered as TUI-style ASCII art
  at startup. Resolution order (first hit wins):

  1. `<active-profile-dir>/splash.png` — per-profile splash override.
  2. `~/.snapdragon/sd/splash.png` — user-level override.

  If neither exists, the existing ASCII cat banner continues to render.

  Implementation notes:

  - Uses [`ink-picture`](https://github.com/endernoke/ink-picture)'s
    `<Image>` component for the actual rendering, with `protocol="ascii"`
    forced so we get character-based art rather than the iTerm/Kitty
    graphics-protocol payloads that fight Ink's Yoga layout.
  - `packages/sd/src/tui/splash-art.ts` resolves the file path; rendering
    is delegated entirely to the upstream component. The controller's
    `loadSplashArt()` is sync — it just patches the resolved path into
    splash state.
  - The `TerminalInfoProvider` is scoped to the splash component only,
    so the rest of the TUI doesn't pay the terminal-capability detection
    cost — and test environments without a real stdin TTY don't get
    blocked on capability queries.
  - `width={40}` keeps the splash chunky and iconic on a typical
    80–120-column terminal.

  Adds `ink-picture@^1.3.5` as a dependency. Removes our home-grown
  `image-renderer.ts` and the `terminal-image` dep alongside it.

- 0a72458: Add a stats panel to the right of the splash dragon — counts of
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

- bd5f02a: Bump the default token budgets so reasoning-enabled prompts actually
  get a chance to produce a reply.

  - `agent.max_tokens` is now **32_000** (was unset → fell through to
    the host package's hardcoded 4096). With reasoning enabled by
    default, the model spent a chunk of that 4K budget on thinking and
    hit `finish_reason=max_tokens` before producing any final text —
    visible as silent `(empty)` rows pre-PR-#23/#24, and as the new
    `provider returned only reasoning, no final content
(finish_reason=max_tokens)` error event after.

  - `agent.context.max_request_tokens` is now **400_000** (was 120_000).
    Claude's 1M-token context window allows up to ~400K of input
    before quality starts to noticeably degrade — that's the headroom
    target for context windowing now.

  Both can still be overridden in `~/.snapdragon/sd/config.yaml`.

- 21b6a6f: TUI viewport wrapping, tool-result rendering, and per-event detail.

  - New `wrapTranscriptRows` (in `packages/sd/src/tui/transcript-wrap.ts`)
    hard-wraps transcript rows to the available viewport columns _before_
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

- ba65b3d: Register `@snapdragon-ai/webtools` as an agent-facing toolset.

  `webtoolsToolset()` (new `packages/webtools/src/toolset.ts`) wraps every
  public function in the package as a `Tool`, exposing 18 tools under the
  `webtools` toolset:

  - `web_search`, `web_extract`, `web_crawl`, `web_crawl_status`
  - `url_normalize`, `url_canonicalize`, `url_cleanup`, `url_host`,
    `url_resolve`, `url_same_or_subdomain`, `url_pattern_match`
  - `robots_check`, `robots_sitemaps`
  - `extract_html`, `extract_html_selector`, `extract_detect_js_only`
  - `content_filter_chunk`, `content_filter_best`

  `sd` wires the toolset into the runtime registry and adds an
  `SdWebtoolsConfig` block (`enabled`, `default_user_agent`,
  `default_timeout_ms`), defaulting to enabled.

  `@snapdragon-ai/webtools` now depends on `@snapdragon-ai/core` and
  `@snapdragon-ai/tools` so it can produce `Tool`/`Toolset` values
  directly. Agents that don't want web access can disable it with
  `webtools: { enabled: false }`.

- 20a9375: Add `sd gateway workers list/show` and split Rust gateway status output between
  logical job workers and daemon worker processes.
- b6b6058: Add append-only JSONL context chunks, deterministic fresh-tail context assembly, and automatic agent-side session compaction. `sd` now enables conservative context windowing by default under `agent.context` while keeping canonical session messages lossless.

### Patch Changes

- 06f11a6: Add provider-level model discovery, OpenAI Codex OAuth helpers, static Codex
  model catalogue, and Responses-native image generation tool support.
- 4e7f1d2: Add gateway-owned runtime breadcrumbs and cancellation control for Pi agent jobs.
  Workers can append durable logs through the gateway client, cancelled jobs stay
  terminal, and `sd` now aborts running Pi RPC jobs when the gateway job is
  cancelled while preserving inspectable job-targeted logs.
- 6e98f88: Ship a pinned, bounded-cache Ink renderer in the CLI package, replace the incompatible mouse plugin with an owned streaming input adapter, and add build/memory diagnostics plus real-renderer reliability coverage.
- 3153bfc: Add interactive exit summaries with resumable session commands and configurable automatic session titles.
- 20a9375: Expose worker-side gateway job lifecycle commands from `sd gateway jobs`.
  Operators and agent adapters can now acquire queued work, complete jobs with an
  optional result artifact, and fail jobs with a clear durable error message.
- d02493b: Show `/paste` in the TUI command autocomplete menu. The command was
  shipped in #15 and worked from the input line, but its registration in
  `tui/input-commands.ts` was missed so it didn't appear in the popup
  list.
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

- 4188e1f: Carry reasoning text from session-resumed messages into the TUI
  transcript. The session JSONL already persists `thinking` blocks, and
  the agent rehydrates them into `runtime.agent.messages` on resume,
  but the UI projection layer (`messageToEntry`) was dropping the
  field — so resuming a session lost the `o ` reasoning rows.

  `messageToEntry` now flattens `Message.thinking: ThinkingBlock[]` into
  the `ChatEntry.thinking` string used by the transcript renderer, so
  resumed sessions show the same reasoning lines you saw live.

- 66d5606: Fix sd TUI transcript rendering: assistant messages now flow through a tiny markdown formatter (headings, blockquotes, inline `code`, `**bold**`) with code blocks rendered verbatim, transcript row keys are stable across streaming edits so the input cursor no longer flickers, and post-tool assistant text segments get their own transcript entry instead of overwriting the pre-tool segment.
- Updated dependencies [3e01d51]
- Updated dependencies [20a9375]
- Updated dependencies [20a9375]
- Updated dependencies [20a9375]
- Updated dependencies [20a9375]
- Updated dependencies [20a9375]
- Updated dependencies [20a9375]
- Updated dependencies [20a9375]
- Updated dependencies [fa4ee6f]
- Updated dependencies [20a9375]
- Updated dependencies [06f11a6]
- Updated dependencies [ef36464]
- Updated dependencies [0b3e66e]
- Updated dependencies [4e7f1d2]
- Updated dependencies [733ef06]
- Updated dependencies [06f11a6]
- Updated dependencies [e9954ec]
- Updated dependencies [5da6090]
- Updated dependencies [d919cbb]
- Updated dependencies [89ef7d8]
- Updated dependencies [06f11a6]
- Updated dependencies [3153bfc]
- Updated dependencies [ba65b3d]
- Updated dependencies [b6b6058]
  - @snapdragon-ai/host@0.2.0
  - @snapdragon-ai/session@0.2.0
  - @snapdragon-ai/config@0.2.0
  - @snapdragon-ai/tools@0.2.0
  - @snapdragon-ai/agent@0.2.0
  - @snapdragon-ai/gateway@0.2.0
  - @snapdragon-ai/ui@0.2.0
  - @snapdragon-ai/content@0.2.0
  - @snapdragon-ai/webtools@0.2.0

## 0.1.1

### Patch Changes

- 4e7eaed: Fix the `sd` binary entrypoint when invoked through an npm `.bin` symlink.
