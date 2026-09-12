# Reliability Cleanup Verification

## Evidence, Not a Universal Crash Claim

This cleanup was developed in four isolated branches from `3548cbd`, then integrated and
checked together. The original gateway-UI working files were preserved. The PRs form an
ordered stack: foreground, sessions/runtime, webtools/WASM, gateway.

Reproduced defects include unbounded Ink text caches, development React timing retention,
oversized session hydration, WASM ABI cleanup gaps, and gateway ownership/backpressure
races. A native V8 OOM stack alone does not identify a retaining object. No exact historical
multi-hour user session has been replayed, and no live-provider run is represented as a test.

## Foreground

The 60-minute production mock soak completed 63,115 frames and 63 mount/resume/reload cycles
under a 512 MiB heap. Peak retained-heap growth after warm-up was 991,336 bytes; final heap
was 23.1 MiB. Input/process listeners and resources returned to baseline after disposal.
RSS was 155.1 MiB, external memory about 19.65 MiB, and ArrayBuffers about 82.4 KiB.

That soak preceded the last small diagnostics-retention/input-flow refinements. The later
combined 10,000-frame regression passed at 23.1 MiB heap, dropping to 22.1 MiB after disposal.
Mouse fragmentation, paste, wheel coalescing, resizing, and real renderer lifecycle tests
remain blocking. See [foreground evidence](reliability.md) for workload details.

## Sessions and WASM

Constrained 128 MiB heap probes exercise 571 MB presentation archives, 537 MB uncompacted
archives, superseded summaries, malformed tails, and oversized records. Canonical archives
remain unchanged; irreducible reads return typed errors. See
[session ownership and limits](reliability-sessions.md).

A separate 5,000-operation webtools probe plateaued at 30 WASM pages (1.875 MiB), with JS
heap below 5 MiB. Disposal removed the owned core from the registry. Combined diagnostics
were also checked against a real core: zero pages before creation, the actual page count
while owned, zero after disposal, and unavailable after unregistering the diagnostic hook.
This measures ownership and linear-memory high water separately from JS heap; it does not
promise immediate native allocator release. See [WASM evidence](reliability-webtools.md).

## Combined Gates and Packaging

The integrated four-slice tree passed `check:push`, including 1,209 changed functions in
coverage-aware CRAP, reliability suites, and native Rust tests. Build and `pack:dry` passed.
Fresh local and temporary-global-prefix installs, with install scripts disabled, exercised
help/version/doctor, a mock prompt, actual Ink mounting, TUI import, single renderer/React
identity, and extraction through the exact packaged WASM artifact. No packages were published.

The first local CRAP runs exposed two checker defects: deleted files were treated as live
sources, and uncommitted edits were not included. Those checks were corrected and rerun.
The resulting learn-job failure-path coverage gap was fixed with tests, not a baseline bump.
No maintainability or architecture baseline was increased.

Git-hook execution also exposed a fixture isolation defect: inherited repository-local Git
variables could redirect temporary-repository operations into the caller. Hooks now clear
those variables before checks; quality fixtures independently sanitize their environment.
Regression tests assert preservation of the outer repository's HEAD, refs, index, config,
and files. Hook validation is distinct from running the same npm command directly.

CI results belong to each PR's exact current head and are reported by GitHub; local results
do not substitute for them. The 60-minute soak is a pre-PR acceptance run, not an every-push
hour-long test. The accelerated 10,000-frame test is blocking on every push.
