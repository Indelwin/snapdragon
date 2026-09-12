# @snapdragon-ai/webtools

Optional web search, fetch, extract, and crawl tools for Snapdragon agents.

This package is not part of the Snapdragon runtime core. Applications opt in by
importing and registering `webtoolsToolset()`; core and agents that do not
register it do not load the bundled WASM artifact or create crawl state.

## Architecture

Two-layer design: pure compute in WASM, I/O in TypeScript.

- **Rust crate `snapdragon-webtools`** (compiled to `wasm32-unknown-unknown`,
  bundled at `dist/snapdragon_webtools.wasm`) handles deterministic, CPU-bound
  work: URL normalisation/canonicalisation, robots.txt parsing, HTML →
  markdown extraction, CSS selectors, BM25 chunk ranking, sitemap parsing,
  content hashing. No network, no FS, no clock — so the wasm module is built
  for `wasm32-unknown-unknown` (no WASI imports) and instantiated with a
  host-owned loader. Failed allocations, traps, and corrupt responses discard
  the stateless instance before the next call.
- **TypeScript host** owns everything that needs an effect: `fetch`, the
  Camofox HTTP-server client, bounded BFS frontier, crawl retention, and
  concurrency control.

The agent-facing surface includes `web_search`, `web_extract`, `web_crawl`,
`web_crawl_status`, `web_crawl_delete`, URL/robots helpers, HTML extraction,
and content filtering.

## Reliability Boundaries

- Every `webtoolsToolset()` owns a disposable crawl store. Completed results
  retain at most 32 entries and 16 MiB for 15 minutes by default. Running
  crawls are separately concurrency-limited. Awaiting store or toolset disposal
  aborts and joins in-flight crawls. Direct `webCrawl()` calls without a store
  return the full result but report that it was not retained.
- HTTP/render responses, HTML and filter inputs, metadata collections, crawl
  queues/results, and WASM ABI requests/responses have validated limits.
  Robots responses and direct robots parser inputs are capped at 512 KiB.
  Intentional HTML/markdown truncation is reported in result metadata; hard
  intermediate limits return explicit resource-budget errors. These limits do
  not alter model context or LLM token budgets.
- `getWebtoolsWasmMemoryStats()` is a synchronous, payload-free snapshot of
  already-instantiated cores. It never loads WASM; its weak registry is capped
  at 256 entries and exposes dropped registrations instead of retaining cores.
  Low-level `UrlUtils`, `Extractor`, `ContentFilter`, `Robots`, and
  `WebtoolsCore` instances expose `dispose()`. Wrapper constructors require an
  explicit `owned` or `borrowed` core contract; factories own their cores, while
  composite operations borrow and dispose their shared core once.
- `build:wasm` atomically packages the Cargo output, verifies byte-for-byte
  parity, and writes `dist/snapdragon_webtools.manifest.json` with source,
  Rust toolchain, and artifact SHA-256 fingerprints. The runtime verifies the
  packaged artifact byte count and SHA-256 before compilation.

`crates/gateway-wasm` is a separate host-independent synthetic fuel-meter
scaffold. It does not currently run this package through Wasmtime, and this
reliability work does not migrate the webtools runtime into the gateway.
