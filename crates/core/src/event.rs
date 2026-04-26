//! Event helpers, routed through `HostPipe::emit_event`.
//!
//! Events are fire-and-forget. Hosts subscribe by topic. design-v3 §6
//! enumerates the standard topics; hosts may define their own.

use alloc::string::String;
use serde::Serialize;

use crate::host::HostPipe;

#[derive(Debug, Clone, Copy)]
pub enum Topic {
    AgentRunStarted,
    AgentRunCompleted,
    AgentRunErrored,
    AgentIterStarted,
    AgentIterCompleted,
    LlmRequestStarted,
    LlmRequestCompleted,
    LlmParseFailed,
    LlmParseRetried,
    ToolInvokeStarted,
    ToolInvokeCompleted,
    ToolInvokeFailed,
    ExecEvalStarted,
    ExecEvalCompleted,
    TrajectoryStepAppended,
    BundleLoaded,
    CapabilityMissing,
}

impl Topic {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AgentRunStarted         => "agent.run.started",
            Self::AgentRunCompleted       => "agent.run.completed",
            Self::AgentRunErrored         => "agent.run.errored",
            Self::AgentIterStarted        => "agent.iter.started",
            Self::AgentIterCompleted      => "agent.iter.completed",
            Self::LlmRequestStarted       => "llm.request.started",
            Self::LlmRequestCompleted     => "llm.request.completed",
            Self::LlmParseFailed          => "llm.parse.failed",
            Self::LlmParseRetried         => "llm.parse.retried",
            Self::ToolInvokeStarted       => "tool.invoke.started",
            Self::ToolInvokeCompleted     => "tool.invoke.completed",
            Self::ToolInvokeFailed        => "tool.invoke.failed",
            Self::ExecEvalStarted         => "exec.eval.started",
            Self::ExecEvalCompleted       => "exec.eval.completed",
            Self::TrajectoryStepAppended  => "trajectory.step.appended",
            Self::BundleLoaded            => "bundle.loaded",
            Self::CapabilityMissing       => "capability.missing",
        }
    }
}

#[derive(Debug)]
pub struct Event<'a> {
    pub topic: Topic,
    pub payload_json: &'a str,
}

/// Emit a typed event through the pipe. Serialisation failure becomes
/// a pseudo-event so observability never silently drops.
pub fn emit<P: Serialize>(host: &dyn HostPipe, topic: Topic, payload: &P) {
    let json = serde_json::to_string(payload).unwrap_or_else(|e| {
        alloc::format!(r#"{{"__emit_error__":"{}"}}"#, e)
    });
    host.emit_event(topic.as_str(), &json);
}

/// Emit a raw event by topic string. Escape hatch for host-specific
/// custom topics.
pub fn emit_raw(host: &dyn HostPipe, topic: &str, payload_json: &str) {
    host.emit_event(topic, payload_json);
}

// --- common payload types -----------------------------------------------

#[derive(Serialize)]
pub struct AgentRunStarted<'a> {
    pub program_id: &'a str,
    pub bundle_cid: Option<&'a str>,
    pub input_len:  usize,
}

#[derive(Serialize)]
pub struct AgentRunCompleted<'a> {
    pub program_id:  &'a str,
    pub duration_ms: u64,
    pub iters_used:  u32,
    pub output_len:  usize,
}

#[derive(Serialize)]
pub struct AgentRunErrored<'a> {
    pub program_id:  &'a str,
    pub duration_ms: u64,
    pub error_kind:  &'a str,
    pub reason:      &'a str,
}

#[derive(Serialize)]
pub struct LlmRequestStarted<'a> {
    pub role:        &'a str,
    pub n_messages:  usize,
}

#[derive(Serialize)]
pub struct LlmRequestCompleted<'a> {
    pub role:         &'a str,
    pub duration_ms:  u64,
    pub response_len: usize,
}

#[derive(Serialize)]
pub struct CapabilityMissing {
    pub cap:      String,
    pub required: bool,
}
