---
'@snapdragon-ai/webtools': patch
---

Bound crawl retention and in-flight work, make crawl state explicitly owned and disposable, and
surface deletion, eviction, expiry, truncation, and resource-budget outcomes.

Harden the Rust/TypeScript WASM ABI with exact allocation ownership, disposable instance recovery,
payload-free diagnostics, request/response limits, and reproducible source, toolchain, and artifact
fingerprints with packaged-binary parity checks.
