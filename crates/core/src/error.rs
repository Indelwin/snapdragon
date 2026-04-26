//! Structured error taxonomy for the `run` export's err arm.
//!
//! The WIT contract says `export run: func(input-json: string)
//!     -> result<string, string>`. When we return `Err(String)`, that
//! string is always JSON encoding a `RunError` so hosts can discriminate
//! programmatically.

use alloc::string::{String, ToString};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RunError {
    NoBundleLoaded,
    InvalidInput {
        reason: String,
    },
    MissingCapability {
        cap: String,
    },
    MissingFeatureSet {
        missing: alloc::vec::Vec<String>,
        present: alloc::vec::Vec<String>,
    },
    HookAborted {
        hook: String,
        reason: String,
    },
    LlmParseFailed {
        attempts: u32,
        last_error: String,
    },
    ToolFailed {
        name: String,
        reason: String,
    },
    ExecFailed {
        reason: String,
    },
    Internal {
        reason: String,
    },
}

impl RunError {
    pub fn to_err_arm(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            // Serialising our own enum should never fail; if it does,
            // return a plain string so the host isn't totally blind.
            format!(r#"{{"kind":"internal","reason":"RunError serialize failed"}}"#)
        })
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal { reason: msg.into() }
    }
}

impl core::fmt::Display for RunError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(&self.to_err_arm())
    }
}

impl From<serde_json::Error> for RunError {
    fn from(e: serde_json::Error) -> Self {
        Self::InvalidInput {
            reason: e.to_string(),
        }
    }
}
