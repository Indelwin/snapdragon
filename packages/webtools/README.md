# @snapdragon-ai/webtools

Web search, fetch, extract, and crawl tools for Snapdragon agents.

## Architecture

Two-layer design — pure compute in WASM, I/O in TypeScript:

- **Rust crate `snapdragon-webtools`** (compiled to `wasm32-unknown-unknown`,
  bundled at `dist/snapdragon_webtools.wasm`) handles deterministic, CPU-bound
  work: URL normalisation/canonicalisation, robots.txt parsing, HTML →
  markdown extraction, CSS selectors, BM25 chunk ranking, sitemap parsing,
  content hashing. No network, no FS, no clock — so the wasm module is built
  for `wasm32-unknown-unknown` (no WASI imports) and instantiated with a
  trivial loader.
- **TypeScript host** owns everything that needs an effect: `fetch`, the
  Camofox HTTP-server client, BFS frontier and concurrency control, retry
  policy, optional caching.

Tools surfaced (planned, same contract as the original hermes-crawler plugin):
`web_search`, `web_extract`, `web_crawl`, `crawl_status`.

## Status

In-progress port from `~/.hermes/plugins/hermes-crawler`. Currently:

- Rust core: `url_util` (parity with hermes, native unit tests passing).
- WASM ABI: `wt_alloc` / `wt_dealloc` + `wt_url_util` dispatcher (linear
  memory, length-prefixed UTF-8, packed `(ptr,len)` u64 return).
- TS host: minimal loader + `url` wrapper. Toolset wiring not yet exposed.
