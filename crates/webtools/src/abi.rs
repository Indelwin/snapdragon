//! Wasm ABI primitives — linear-memory allocator exports and JSON marshalling.
//!
//! The exports here are the entire low-level surface the TS loader needs to
//! cooperate with the crate:
//!
//! - `wt_alloc(size: u32) -> *mut u8`     — host-allocate request buffer.
//! - `wt_dealloc(ptr: *mut u8, size: u32)` — host frees a previously returned buffer.
//!
//! Both go through `alloc::alloc::{alloc,dealloc}` with `Layout::array::<u8>`.
//! Allocation failures abort, matching the workspace `panic = "abort"`
//! release profile — the TS side surfaces this as a wasm trap.

use serde_json::Value;
use std::alloc::{Layout, alloc, dealloc};

/// Allocate `size` bytes of linear memory and return a raw pointer.
///
/// Returns a null pointer when `size == 0` (still valid for the host loop to
/// notice an empty argument). Aborts on allocation failure.
#[unsafe(no_mangle)]
pub extern "C" fn wt_alloc(size: u32) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    let layout = Layout::array::<u8>(size as usize).expect("alloc layout overflow");
    // Safety: layout is non-zero size by the guard above.
    let ptr = unsafe { alloc(layout) };
    if ptr.is_null() {
        // Match the workspace `panic = "abort"` profile; surfaces as a wasm
        // trap on the host side so allocation failure can't be silently
        // mistaken for a valid pointer.
        std::alloc::handle_alloc_error(layout);
    }
    ptr
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
    let layout = Layout::array::<u8>(size as usize).expect("dealloc layout overflow");
    // Safety: TS contract is that `(ptr, size)` came from `wt_alloc` or from
    // the packed return value of another export, both of which use the same
    // `Layout::array::<u8>` shape.
    unsafe { dealloc(ptr, layout) };
}

/// Decode a JSON request buffer at `(ptr, len)` into a `serde_json::Value`.
///
/// Safety: caller guarantees `(ptr, len)` is a valid slice inside our linear
/// memory. The buffer is copied (`from_raw_parts` to `to_vec`) so the host is
/// free to reuse or free it after the call returns.
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
/// `into_raw_parts` would be cleaner, but `Vec::into_raw_parts` is unstable —
/// the manual `mem::forget` here is the stable equivalent.
pub(crate) fn json_out(value: &Value) -> u64 {
    let s = serde_json::to_string(value).unwrap_or_else(|_| {
        // Last-ditch fallback so we never panic across the ABI boundary on
        // malformed responses — would only fire on data we constructed
        // ourselves, but be defensive.
        r#"{"ok":false,"error":"serialisation failed"}"#.to_string()
    });
    let mut bytes = s.into_bytes();
    bytes.shrink_to_fit();
    let ptr = bytes.as_mut_ptr();
    let len = bytes.len() as u32;
    std::mem::forget(bytes);
    ((ptr as u64) << 32) | (len as u64)
}
