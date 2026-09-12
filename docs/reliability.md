# Reliability Cleanup

Foreground reliability work merged in PR #104. The remaining session/runtime, webtools/WASM,
and gateway reliability work is in the consolidated reliability PR.

## Scope and Evidence

This pass separates foreground JavaScript retention, session hydration, WebAssembly allocation,
and gateway orchestration. A V8 heap-limit stack trace identifies the allocation that failed;
it does not establish which component retained the memory.

The foreground reproduction uses the actual Ink renderer and `SdTuiApp`, injected terminal
streams, changing text/tool output, fragmented wheel input, resizes, and repeated mount/resume
cycles. It discards terminal output instead of accumulating test-library frames. All fixture
configuration, sessions, and tool inputs live in a temporary home. No live provider is contacted.

Confirmed during investigation:

- Ink 7.0.1's process-wide measurement and wrapping caches retained unique text without bounds.
- Bounding those caches alone did not make the development-renderer stress test pass.
- React 19 development instrumentation retained `PerformanceMeasure` objects in Node's User
  Timing buffer. The synthetic heap snapshot identified that buffer as a root, and clearing
  measures in a diagnostic experiment prevented the growth. Production code does not clear
  global timing entries belonging to the embedding host.
- A short V8 sliced string can retain a much larger parent. Cache accounting therefore also
  requires independently owned copies of stored string keys and values, not only an LRU limit.
- The same 10,000-frame workload in production rendering stayed below 25 MiB retained JS heap
  in the initial probe, while development rendering exhausted a 512 MiB heap before 1,000 frames.
- The exact historical multi-hour user session has not been replayed. A passing synthetic
  workload is evidence for the exercised paths, not proof that every historical crash is fixed.

## Renderer Distribution

`packages/ink` contains the minimal `@snapdragon-ai/ink` fork, pinned to the official Ink 7.0.1
archive by SHA-512. Its build overlays only the measurement/wrapping caches and their bounded
LRU helper. Each cache is limited to 4,096 entries and an 8 MiB text/entry accounting budget.
The upstream MIT license and provenance are retained; see `packages/ink/UPSTREAM.md`.

The workspace `ink` alias and root override resolve all local renderer consumers to that fork.
The sd tarball bundles the fork and its runtime dependencies, without bundling React peers.
The unused `ink-picture` dependency is removed; the existing splash renderer declares its
`sharp` dependency directly. Fresh-install tests ensure one renderer and React instance.
Packaging stages the renderer tree before packing and removes
the staging copies afterward. There is no consumer-side post-install mutation of `node_modules`.
The staged bundle omits React peer declarations that npm otherwise mistakes for bundled
files during global installation. The published fork retains its peer contract; the CLI's
direct React dependency supplies the staged renderer. Build identity includes the staged
metadata, and postpack restores the workspace manifest. Concurrent packs fail explicitly.

The direct CLI entry point defaults `NODE_ENV` to `production` before dynamically loading the
runtime/TUI. An explicitly supplied value is preserved. Importing sd as a library never changes
the embedding host's environment. Hosts embedding the TUI should use production React builds
for long-lived sessions; development instrumentation is not a supported memory-soak baseline.

Mouse scrolling remains enabled. An sd-owned adapter filters SGR reports before Ink, forwards
ordinary and bracketed-paste bytes, coalesces wheel events, and owns terminal-mode cleanup.
It enables button/wheel reporting and SGR encoding, not continuous pointer-motion reporting.

## Operational Diagnosis

Run `sd doctor --json` to identify the executable, package and renderer versions, source/build
fingerprints, and packaged WASM hashes. A missing source checkout in a global installation is
not a source mismatch. Normal `sd --version` output remains unchanged.

`sd --diagnostics` opts into bounded JSONL memory/resource samples. Samples contain numeric
memory measurements, resource counts, and a fixed run-phase label, not prompts, credentials,
tool arguments, or heap snapshots. Treat JS heap, RSS, external/ArrayBuffer memory, and WASM
linear-memory pages as different measurements: low heap does not establish low native memory.

## Repeatable Checks

- `npm run test:reliability` builds packages and executes registered workspace reliability suites.
  It is blocking in `check:push`.
- The TUI suite runs 10,000 real frames with `--max-old-space-size=512 --expose-gc` and rejects
  retained-heap growth above 32 MiB after warm-up. It also checks listener cleanup.
- `npm run test:reliability:soak` runs the mock foreground workload for 60 minutes. Sampled
  metrics are written under ignored `.quality/reliability/`; samples contain no conversation text.
- `node scripts/reliability/packed-smoke.mjs` installs freshly packed packages in an empty
  temporary directory with install scripts disabled, checks CLI surfaces/single-renderer
  resolution, and performs extraction with the packaged WASM binary. Build WASM first.

Release verification must also include `check:push`, `build`, `pack:dry`, native Rust tests,
and the session/WASM/gateway-specific failure tests. Do not increase quality baselines to
make these checks pass. Publishing packages requires separate approval.

## Local Verification Record

On Node 22.22.3, Darwin arm64, the production-renderer mock soak completed 63,115 frames
in 3,600.064 seconds under a 512 MiB heap, including 63 resume/reload mount cycles.
Peak retained-heap growth after warm-up was 991,336 bytes (0.95 MiB), below the 32 MiB gate.
The final sample reported 23.1 MiB heap and 155.1 MiB RSS. External memory stayed near
19.65 MiB and ArrayBuffers near 82.4 KiB. After disposal, heap was 22.3 MiB and only the
two pre-existing pipe resources remained; input/process listeners returned to baseline.
User Timing entries stayed at zero. This fixture does not load webtools WASM, so its WASM
page field is explicitly unavailable rather than zero; the separate WASM probe measures it.

That soak began before the final diagnostics-retention and input-flow restoration refinements.
The final source at `e66e153` separately passed the complete `check:push` gate, including the
10,000-frame renderer test, focused lifecycle tests, native Rust tests, and coverage gates.
`pack:dry` and fresh local/global-prefix installs passed help/version/doctor/mock prompt,
actual Ink mount, TUI import, single renderer/React identity, and packaged WASM extraction.
Install scripts were disabled. No live-provider or user-session replay was performed.

## Interpretation

Record the branch/commit, Node version, renderer identity, exact workload, elapsed time,
heap plateau, RSS/external-memory behavior, and disposal results with each verification run.
Investigate growing post-GC heap separately from a bounded cache warming up or a WASM
instance retaining its high-water allocation. Never automatically collect user heap snapshots:
they can contain credentials and complete conversation/tool data.
