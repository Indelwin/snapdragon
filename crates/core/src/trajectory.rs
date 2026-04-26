//! Trajectory events — what the agent emits to `host::log_trajectory`.
//!
//! Kept deliberately simple in v0.1: a tag, a module id, and structured
//! payload. The optimizer service consumes these from the host's storage
//! and uses them to build training sets for MIPRO/COPRO.

use alloc::string::String;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TrajectoryEvent {
    /// A module was invoked.
    ModuleCall {
        module_id: String,
        signature_name: String,
        input: Value,
    },
    /// A module produced output (or failed).
    ModuleResult {
        module_id: String,
        output: Option<Value>,
        error: Option<String>,
        latency_ms: u64,
    },
    /// A run completed end-to-end (or crashed).
    RunComplete {
        program_id: String,
        bundle_cid: Option<String>,
        success: bool,
        error: Option<String>,
    },
}

impl TrajectoryEvent {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}
