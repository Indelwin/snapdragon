//! Wasm ABI primitives — linear-memory allocator exports and JSON marshalling.
//!
//! The exports here are the entire low-level surface the TS loader needs to
//! cooperate with the crate:
//!
//! - `wt_alloc(size: u32) -> *mut u8`     — host-allocate request buffer.
//! - `wt_dealloc(ptr: *mut u8, size: u32)` — host frees a previously returned buffer.
//!
//! Both request and response buffers are exact-length boxed byte slices. That
//! gives `wt_dealloc` one matching ownership contract for every pointer that
//! crosses the ABI. Allocation failures abort, matching the workspace
//! `panic = "abort"` release profile — the TS side surfaces this as a wasm
//! trap.

use serde_json::Value;
use std::io::{self, Write};

const MAX_JSON_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const RESPONSE_BUDGET_ERROR: &[u8] =
    br#"{"ok":false,"error":"WASM response bytes budget exceeded"}"#;

/// Allocate `size` bytes of linear memory and return a raw pointer.
///
/// Returns a null pointer when `size == 0` (still valid for the host loop to
/// notice an empty argument). Aborts on allocation failure.
#[unsafe(no_mangle)]
pub extern "C" fn wt_alloc(size: u32) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    let bytes = vec![0_u8; size as usize].into_boxed_slice();
    Box::into_raw(bytes).cast::<u8>()
}

/// Free a buffer previously returned by an exported function.
///
/// `size` must match the original allocation length. The TS side reads this
/// from the packed `(ptr, len)` return value of each exported function.
#[unsafe(no_mangle)]
pub extern "C" fn wt_dealloc(ptr: *mut u8, size: u32) {
    if ptr.is_null() || size == 0 {
        return;
    }
    let slice = std::ptr::slice_from_raw_parts_mut(ptr, size as usize);
    // Safety: the ABI contract requires `(ptr, size)` to be the exact pair
    // returned by `wt_alloc` or unpacked from an exported response. Both are
    // created with `Box<[u8]>`, and ownership crosses the ABI exactly once.
    unsafe { drop(Box::from_raw(slice)) };
}

/// Decode a JSON request buffer at `(ptr, len)` into a `serde_json::Value`.
///
/// Safety: caller guarantees `(ptr, len)` is a valid slice inside our linear
/// memory. `serde_json::Value` owns all parsed strings, so the host is free to
/// reuse or free the request buffer after the call returns.
pub(crate) fn json_in(ptr: *const u8, len: u32) -> Result<Value, serde_json::Error> {
    if ptr.is_null() || len == 0 {
        return Ok(Value::Null);
    }
    // Safety: see fn doc; pointer is validated by the export's contract.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
    serde_json::from_slice(bytes)
}

/// Serialise `value` as JSON, leak it as a heap buffer, and pack `(ptr, len)`
/// into a single `u64` (`ptr << 32 | len`).
///
/// The TS side reads the high 32 bits as the pointer and the low 32 as the
/// length, then calls `wt_dealloc(ptr, len)` once it has copied the bytes out.
/// The exact-length `Box<[u8]>` is deliberately the same allocation shape as
/// `wt_alloc`, so `wt_dealloc(ptr, len)` always reconstructs the original box.
pub(crate) fn json_out(value: &Value) -> u64 {
    let bytes = json_bytes(value);
    let len = bytes.len() as u32;
    let ptr = Box::into_raw(bytes).cast::<u8>();
    ((ptr as u64) << 32) | (len as u64)
}

fn json_bytes(value: &Value) -> Box<[u8]> {
    let mut writer = BoundedWriter::new(MAX_JSON_OUTPUT_BYTES);
    if serde_json::to_writer(&mut writer, value).is_err() {
        return RESPONSE_BUDGET_ERROR.to_vec().into_boxed_slice();
    }
    writer.into_bytes().into_boxed_slice()
}

struct BoundedWriter {
    bytes: Vec<u8>,
    limit: usize,
}

impl BoundedWriter {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Vec::new(),
            limit,
        }
    }

    fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

impl Write for BoundedWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if buffer.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("JSON output byte budget exceeded"));
        }
        self.bytes
            .try_reserve_exact(buffer.len())
            .map_err(io::Error::other)?;
        self.bytes.extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_JSON_OUTPUT_BYTES, json_bytes, wt_alloc, wt_dealloc};
    use serde_json::json;

    #[test]
    fn allocated_bytes_round_trip_through_matching_boxed_slice_contract() {
        let len = 32;
        let ptr = wt_alloc(len);
        assert!(!ptr.is_null());

        // Safety: `wt_alloc(len)` returned an owned, writable allocation of
        // exactly `len` bytes, and this test returns it once via `wt_dealloc`.
        unsafe {
            std::slice::from_raw_parts_mut(ptr, len as usize).fill(0xa5);
        }
        wt_dealloc(ptr, len);
    }

    #[test]
    fn zero_length_allocation_and_deallocation_are_noops() {
        assert!(wt_alloc(0).is_null());
        wt_dealloc(std::ptr::null_mut(), 0);
    }

    #[test]
    fn json_output_round_trips_through_the_same_free_contract() {
        let bytes = json_bytes(&json!({ "ok": true, "value": "owned" }));
        let len = bytes.len() as u32;
        let ptr = Box::into_raw(bytes).cast::<u8>();
        // Safety: `json_bytes` returned this exact readable allocation.
        let value: serde_json::Value = unsafe {
            serde_json::from_slice(std::slice::from_raw_parts(ptr, len as usize)).unwrap()
        };
        assert_eq!(value["value"], "owned");
        wt_dealloc(ptr, len);
    }

    #[test]
    fn json_output_budget_returns_a_small_error_envelope() {
        let value = json!({ "value": "x".repeat(MAX_JSON_OUTPUT_BYTES) });
        let bytes = json_bytes(&value);
        assert!(bytes.len() < 1_024);
        let response: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(response["ok"], false);
        assert!(
            response["error"]
                .as_str()
                .unwrap()
                .contains("budget exceeded")
        );
    }
}
