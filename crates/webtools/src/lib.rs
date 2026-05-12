//! Snapdragon web-crawling primitives, compiled to wasm32-unknown-unknown.
//!
//! ## Architecture
//!
//! The webtools crate is the **pure-compute** half of `@snapdragon-ai/webtools`.
//! It owns work that benefits from being fast and deterministic:
//!
//! - URL normalisation & canonicalisation (`url_util`)
//! - robots.txt parsing & matching (TODO)
//! - HTML → markdown extraction (TODO)
//! - CSS-selector extraction (TODO)
//! - BM25 chunk ranking (TODO)
//! - sitemap.xml / sitemap-index parsing (TODO)
//!
//! The TS package owns everything that needs the network or a real filesystem:
//! HTTP fetch, the Camofox HTTP client, BFS orchestration, retries, cache.
//!
//! ## ABI
//!
//! All exports follow a single shape:
//!
//! ```text
//!   wt_<name>(args_ptr: *const u8, args_len: u32) -> u64
//! ```
//!
//! - Inputs are UTF-8 JSON in linear memory; the host calls `wt_alloc(n)` first,
//!   writes JSON, then calls the export.
//! - Outputs are also UTF-8 JSON. The return value packs `(ptr, len)`:
//!   `ptr = (ret >> 32) as u32`, `len = (ret & 0xFFFF_FFFF) as u32`.
//! - The host MUST call `wt_dealloc(ptr, len)` to free returned buffers.
//! - Allocation failures panic; panics abort (see workspace release profile).
//!
//! Keeping the surface ABI minimal (alloc/dealloc + JSON ptr-len) means the TS
//! loader is `WebAssembly.instantiate(buf)` plus a ~40-line marshal helper —
//! no WASI, no jco, no preview2-shim.

pub mod abi;
pub mod content_filter;
pub mod extractor;
mod extractor_boilerplate;
mod extractor_clean;
mod extractor_dispatch;
mod extractor_markdown;
mod extractor_metadata;
mod extractor_render;
mod extractor_spa;
mod extractor_text;
pub mod robots;
mod robots_dispatch;
mod robots_match;
mod robots_parse;
mod robots_pattern;
mod url_canon;
mod url_dispatch;
mod url_match;
mod url_params;
mod url_parts;
pub mod url_util;

// --- Exported ABI surface -------------------------------------------------
//
// These wrappers are intentionally thin. They:
//   1. read the JSON request buffer the host placed in our memory,
//   2. dispatch to a typed handler in the relevant module,
//   3. serialise the response back as JSON,
//   4. pack the (ptr, len) return value.
//
// Each handler returns `serde_json::Value` so the JSON envelope shape is
// `{ "ok": ..., "value": ... }` or `{ "ok": false, "error": "..." }`. The TS
// side relies on that envelope.

use crate::abi::{json_in, json_out};
use serde_json::json;

/// `wt_url_util(json) -> json` — dispatch table for the url_util module.
///
/// Request shape: `{ "op": "<name>", "args": <op-specific> }`.
/// See `src/url_util.rs` for the per-op argument contracts.
#[unsafe(no_mangle)]
pub extern "C" fn wt_url_util(ptr: *const u8, len: u32) -> u64 {
    let response = match json_in(ptr, len) {
        Ok(req) => url_util::dispatch(req),
        Err(e) => json!({ "ok": false, "error": format!("invalid request: {e}") }),
    };
    json_out(&response)
}

/// `wt_robots(json) -> json` — pure robots.txt parse/check operations.
#[unsafe(no_mangle)]
pub extern "C" fn wt_robots(ptr: *const u8, len: u32) -> u64 {
    let response = match json_in(ptr, len) {
        Ok(req) => robots::dispatch(req),
        Err(e) => json!({ "ok": false, "error": format!("invalid request: {e}") }),
    };
    json_out(&response)
}

/// `wt_content_filter(json) -> json` — markdown chunking and BM25 ranking.
#[unsafe(no_mangle)]
pub extern "C" fn wt_content_filter(ptr: *const u8, len: u32) -> u64 {
    let response = match json_in(ptr, len) {
        Ok(req) => content_filter::dispatch(req),
        Err(e) => json!({ "ok": false, "error": format!("invalid request: {e}") }),
    };
    json_out(&response)
}

/// `wt_extractor(json) -> json` — HTML extraction and JS-only heuristics.
#[unsafe(no_mangle)]
pub extern "C" fn wt_extractor(ptr: *const u8, len: u32) -> u64 {
    let response = match json_in(ptr, len) {
        Ok(req) => extractor::dispatch(req),
        Err(e) => json!({ "ok": false, "error": format!("invalid request: {e}") }),
    };
    json_out(&response)
}
