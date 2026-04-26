//! Hooks — capability calls that let the host steer the agent loop.
//!
//! Hooks are capability calls by naming convention (`hook.<name>@1`). The
//! agent emits the current payload, the host returns a possibly-modified
//! payload, and the agent proceeds with the returned value. Missing
//! handlers return an identity response (no change).
//!
//! This gives hosts the Hermes-style composition surface (memory
//! prefetch, context compression, tool argument rewriting, response
//! sanitisation) without any shared mutable state across the WIT
//! boundary.

use crate::capability::call;
use crate::host::{CallError, HostPipe};
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

/// A host-returned hook response. Either `no_change`, an updated payload,
/// or an explicit `abort`.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum HookResponse<T> {
    Abort { abort: String },
    Patch { patch: T },
    NoChange {},
}

/// The hook points v0.1 core fires.
#[derive(Debug, Clone, Copy)]
pub enum Hook {
    BeforeLlmRequest,
    AfterLlmResponse,
    BeforeToolInvoke,
    AfterToolInvoke,
    BeforeIter,
    BeforeFinalize,
}

impl Hook {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::BeforeLlmRequest => "hook.before_llm_request@1",
            Self::AfterLlmResponse => "hook.after_llm_response@1",
            Self::BeforeToolInvoke => "hook.before_tool_invoke@1",
            Self::AfterToolInvoke => "hook.after_tool_invoke@1",
            Self::BeforeIter => "hook.before_iter@1",
            Self::BeforeFinalize => "hook.before_finalize@1",
        }
    }
}

/// Call a hook. If the host hasn't registered a handler, returns the
/// caller's original payload unchanged (identity). If the host returned
/// a patch, returns the patched value. If the host explicitly aborts,
/// returns `HookAbort` so the caller can surface it as an agent error.
pub fn invoke<Req: Serialize, Patch: for<'de> Deserialize<'de>>(
    host: &dyn HostPipe,
    hook: Hook,
    req: &Req,
) -> Result<HookOutcome<Patch>, CallError> {
    match call::<Req, HookResponse<Patch>>(host, hook.as_str(), req) {
        Ok(HookResponse::NoChange {}) => Ok(HookOutcome::NoChange),
        Ok(HookResponse::Patch { patch }) => Ok(HookOutcome::Patch(patch)),
        Ok(HookResponse::Abort { abort }) => Ok(HookOutcome::Abort(abort)),
        Err(CallError::NotProvided { .. }) => Ok(HookOutcome::NoChange),
        Err(e) => Err(e),
    }
}

/// The three outcomes a hook call can have from the caller's POV.
#[derive(Debug)]
pub enum HookOutcome<Patch> {
    /// Host didn't register or explicitly returned {}. Proceed with the
    /// original payload.
    NoChange,
    /// Host returned a patch. Use it in place of the original payload.
    Patch(Patch),
    /// Host explicitly aborted; surface as an agent error with this reason.
    Abort(String),
}

// --- v0.1 payload shapes for each hook ----------------------------------

#[derive(Serialize)]
pub struct BeforeLlmRequestReq<'a> {
    pub module_id: &'a str,
    pub iter: u32,
    pub messages: &'a [crate::component::Message],
}

#[derive(Deserialize)]
pub struct BeforeLlmRequestPatch {
    pub messages: Vec<crate::component::Message>,
}

#[derive(Serialize)]
pub struct AfterLlmResponseReq<'a> {
    pub module_id: &'a str,
    pub iter: u32,
    pub raw_response: &'a str,
}

#[derive(Deserialize)]
pub struct AfterLlmResponsePatch {
    pub raw_response: String,
}

#[derive(Serialize)]
pub struct BeforeToolInvokeReq<'a> {
    pub module_id: &'a str,
    pub iter: u32,
    pub tool_name: &'a str,
    #[serde(with = "serde_json_raw")]
    pub tool_args: &'a serde_json::Value,
}

#[derive(Deserialize)]
pub struct BeforeToolInvokePatch {
    pub tool_name: String,
    pub tool_args: serde_json::Value,
}

#[derive(Serialize)]
pub struct AfterToolInvokeReq<'a> {
    pub module_id: &'a str,
    pub iter: u32,
    pub tool_name: &'a str,
    pub observation: &'a str,
}

#[derive(Deserialize)]
pub struct AfterToolInvokePatch {
    pub observation: String,
}

// --- Message helpers removed — use `component::Message` directly -------

// Serde helper: emit &serde_json::Value inline (as object, not string).
mod serde_json_raw {
    use serde::{Serialize, Serializer};
    pub fn serialize<S: Serializer>(v: &&serde_json::Value, ser: S) -> Result<S::Ok, S::Error> {
        (*v).serialize(ser)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_names_have_version_suffix() {
        for h in [
            Hook::BeforeLlmRequest,
            Hook::AfterLlmResponse,
            Hook::BeforeToolInvoke,
            Hook::AfterToolInvoke,
            Hook::BeforeIter,
            Hook::BeforeFinalize,
        ] {
            assert!(h.as_str().starts_with("hook."));
            assert!(h.as_str().ends_with("@1"));
        }
    }

    #[test]
    fn hook_response_deserialises_three_variants() {
        let no_change: HookResponse<AfterLlmResponsePatch> = serde_json::from_str("{}").unwrap();
        assert!(matches!(no_change, HookResponse::NoChange {}));

        let abort: HookResponse<AfterLlmResponsePatch> =
            serde_json::from_str(r#"{"abort":"too unsafe"}"#).unwrap();
        assert!(matches!(abort, HookResponse::Abort { .. }));

        let patch: HookResponse<AfterLlmResponsePatch> =
            serde_json::from_str(r#"{"patch":{"raw_response":"cleaned up"}}"#).unwrap();
        assert!(matches!(patch, HookResponse::Patch { .. }));
    }
}
