//! The `Module` trait and built-in implementations.
//!
//! v0.1 ships one implementation: `Predict`. Future modules (`ReACT`, `RLM`,
//! `ChainOfThought`) plug in at this same trait boundary.

use crate::signature::Signature;
use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

/// A Module is a unit of LLM-driven computation: signature in, signature out.
/// Modules are pure data — they carry their Signature and whatever compiled
/// state (instructions, demos) the optimizer produced.
pub trait Module {
    /// Unique ID within a Program's module graph. Used as the key for
    /// instructions/demos in a compiled bundle.
    fn id(&self) -> &str;

    /// This module's declared signature.
    fn signature(&self) -> &Signature;

    /// Build the prompt messages for a given input. Implementations combine
    /// instructions, few-shot demos, and the live input into role-tagged
    /// chat messages the `Runner` will hand to `host::chat`.
    fn build_messages(&self, input: &Value) -> Vec<(String, String)>;
}

/// A `Predict` module: signature in, one LLM call, signature-typed output.
/// The simplest possible Module — no scratchpad, no tools, no iteration.
pub struct Predict {
    id: String,
    signature: Signature,
    /// Compiled instruction string, filled by the optimizer. Empty if the
    /// module is uncompiled (fresh out of `new`).
    pub instructions: String,
    /// Few-shot demos, each `{inputs: {...}, outputs: {...}}`.
    pub demos: Vec<Value>,
}

impl Predict {
    pub fn new(id: impl Into<String>, signature: Signature) -> Self {
        Self {
            id: id.into(),
            signature,
            instructions: String::new(),
            demos: Vec::new(),
        }
    }
}

impl Module for Predict {
    fn id(&self) -> &str {
        &self.id
    }

    fn signature(&self) -> &Signature {
        &self.signature
    }

    fn build_messages(&self, _input: &Value) -> Vec<(String, String)> {
        // Intentional v0.1 stub. The real implementation renders:
        //   system:  signature preamble + instructions
        //   user:    demo_1.input  assistant: demo_1.output  (few-shot)
        //   ...
        //   user:    <live input>
        // That lands in the next commit alongside the runner.
        Vec::new()
    }
}
