# Session and Runtime Reliability

## Ownership and Storage

Canonical JSONL records remain append-only. Presentation statistics and recent-message views
use streaming readers instead of loading the archive. Background memory and skill scans use
record/byte-budgeted batches with persisted byte offsets and partial-line state. Oversized
presentation records are skipped or previewed within a fixed buffer budget; canonical data
is not deleted.

Context chunks now support hierarchical rollups with child references, depth, and source
ranges. Existing flat chunks remain leaf summaries. Assembly validates a contiguous active
frontier and combines it with the fresh canonical tail. Invalid or interrupted rollups do not
advance the coverage watermark past missing source records. Summary-only pressure can roll
up summaries themselves; irreducible request input returns a typed context-budget error.
Provider/output limits and unlimited agent turns are unchanged.

Context readers retain only the validated active summary frontier, releasing superseded
summary text as rollups are read. `compactContext` streams uncompacted canonical records
through 4 MiB batches before request assembly, appending leaf summaries and rollups while
preserving the configured fresh tail and complete tool-call groups. Original archive bytes
are unchanged, including interrupted trailing records. Returned compaction chunks contain
the newly written chunks still in the active frontier, rather than their superseded history.

Context records are limited to 1 MiB of encoded JSON. Materialized context reads have an
8 MiB / 16,384-record ceiling; streaming precompaction starts at 4 MiB / 8,192 records.
An oversized fresh record, protected tail, or non-shrinking batch raises the exported
`ContextReadBudgetExceededError` (`CONTEXT_READ_BUDGET_EXCEEDED`) instead of omitting content.
Direct `assembleContext` callers must compact first when this bounded read reports pressure;
agent preflight already compacts before assembly and retries its existing smaller fresh-tail
candidates for aggregate read pressure. Individual oversized records fail immediately.
These storage read limits do not alter
provider, output, or request token budgets.

An explicit `maxRequestTokens` is a hard preflight limit even without a session or when
`enabled: false` disables compaction. Omitting that limit does not introduce a new cap.

## Runtime and Reload

`stopSdRuntime` is awaitable and idempotent. Agents abort provider requests and retry sleeps,
wait for prompt cleanup, and dispose registries they own. Caller-supplied registries remain
borrowed. Extensions can register disposables and optional deactivation hooks.

Registry disposal joins pending availability checks before disposing owned toolsets; a late
check cannot reinstall tools. Cleanup attempts every owner and then rejects with an
`AggregateError` if any disposer failed. Agent/runtime disposal propagates that failure and
returns the same settled promise on later calls. A rebuild whose old cleanup fails keeps its
successfully prepared replacement active while reporting the cleanup failure.

Runtime rebuilds prepare a candidate before replacing the active runtime. Failed candidates
dispose their resources; newly created empty candidate sessions are removed, while existing
sessions remain intact. Successful replacement notifies agent observers explicitly and then
disposes the old resources.

Plain `/reload` refreshes data/configuration in process. `/reload build`, `/reload pull`, and
`/reload sync` return an executable restart request. The direct CLI uses one thin supervisor
to replace its child, carrying session, provider, model, profile, and draft state. Library
embedding receives the request instead of exiting its host. A no-session conversation is
not silently discarded by executable reload.

Supervised print-mode OS shutdown cancels the provider and awaits runtime cleanup before
returning 130 for SIGINT or 143 for SIGTERM. Unrelated provider or cleanup failures remain
errors instead of being classified as successful signal shutdown.

## Verification

The implementation commits `89aa05b` and `2fe0e70` passed the complete `check:push` gate,
including 123 focused session/runtime tests, provider cancellation, registry ownership,
hierarchical context assembly, incremental scans, rebuild failures, and CLI lifecycle tests.
`test:reliability:sessions` is registered with the blocking root reliability gate.

The gate also runs archive probes with `--max-old-space-size=128`: a 571 MB presentation
archive, a 537 MB archive with no existing summaries, 269 MB of superseded summaries, and a
268 MB individual fresh record. The no-summary probe checks the original archive hash and
the existing request token budget after precompaction; the oversized-record probe requires
a typed error. A passing constrained-heap run establishes bounded heap for these cases,
not a 128 MiB RSS ceiling.

These tests establish bounded behavior for the exercised readers and ownership paths, not
that every historical multi-hour OOM has been reproduced. Renderer and WASM retention are
separate slices. Fresh packed-install and combined-branch verification are recorded with
the PR; no packages are published by this change.
