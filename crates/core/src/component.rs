//! Components — the typed state bag that makes up one agent entity.
//!
//! An entity (one agent run) is a bag of named components. Presence is
//! meaningful: an entity without `Final` or `Error` is still running.
//!
//! This module declares the v0.1 component set (design-v4 §3). Adding
//! a component is a core version bump; adding an *extension* component
//! is a host-side decision and doesn't require a core change — see
//! `ExtensionComponent` at the bottom.
//!
//! Components are designed for two consumers:
//!   - The agent core itself (reading/writing during the step loop).
//!   - The Layer 2 host library (querying by presence, e.g.
//!     "give me every entity with PendingLlmCall"). Layer 3 hosts use
//!     the same surface, backed by ETS instead of an in-process Map.

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::bundle::Bundle;
use crate::error::RunError;
use crate::profile::Profile;
use crate::trajectory::TrajectoryEvent;

/// Canonical names of all core-owned components. A component may be
/// absent from an entity; absence is a meaningful state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComponentName {
    // Creation-time, immutable after set
    RunId,
    Identity,
    Input,
    Bundle,

    // Resolved early in the schedule
    Profile,
    Schedule,

    // Mutable during the run
    Trajectory,
    CurrentMessages,
    PendingLlmCall,
    LastLlmResponse,
    ParsedAction,
    PendingToolCall,
    LastObservation,
    SessionId, // RLM only
    IterCounter,

    // Tool calling + reasoning
    AvailableTools,
    PendingToolCalls,
    LastThinkingBlocks,

    // Terminal
    Final,
    Error,
}

impl ComponentName {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RunId => "RunId",
            Self::Identity => "Identity",
            Self::Input => "Input",
            Self::Bundle => "Bundle",
            Self::Profile => "Profile",
            Self::Schedule => "Schedule",
            Self::Trajectory => "Trajectory",
            Self::CurrentMessages => "CurrentMessages",
            Self::PendingLlmCall => "PendingLlmCall",
            Self::LastLlmResponse => "LastLlmResponse",
            Self::ParsedAction => "ParsedAction",
            Self::PendingToolCall => "PendingToolCall",
            Self::LastObservation => "LastObservation",
            Self::SessionId => "SessionId",
            Self::IterCounter => "IterCounter",
            Self::AvailableTools => "AvailableTools",
            Self::PendingToolCalls => "PendingToolCalls",
            Self::LastThinkingBlocks => "LastThinkingBlocks",
            Self::Final => "Final",
            Self::Error => "Error",
        }
    }
}

// --- Component payload types --------------------------------------------

/// Multi-tenant auth context. v0.1 Bun host fills this with
/// `{principal:"owner", tenant:"local"}`; Layer 3 hosts fill it from
/// the authenticated channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identity {
    pub principal: String,
    #[serde(default)]
    pub tenant: Option<String>,
    #[serde(default)]
    pub session: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Permissions {
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IterCounter {
    pub iter: u32,
    pub max_iters: u32,
    pub llm_calls_used: u32,
    pub max_llm_calls: u32,
}

/// One message in a chat turn history. Shape matches llm.chat@1's
/// canonical form (OpenAI-aligned): assistant turns that request tools
/// carry `tool_calls`; role="tool" messages carry `tool_call_id` and
/// the result content; assistant turns with reasoning traces carry
/// `thinking` blocks that must be preserved verbatim across turns for
/// Anthropic compatibility.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Message {
    pub role: String,
    #[serde(default)]
    pub content: String,
    /// Tool calls this assistant message requests. Only meaningful
    /// when role="assistant".
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    /// Set on role="tool" messages to link them to the originating
    /// assistant tool_call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Reasoning blocks preserved from an earlier assistant turn.
    /// Only meaningful when role="assistant". For Anthropic these MUST
    /// be preserved with signatures when this turn also carries
    /// tool_calls following a prior tool_use, or the API rejects 400.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thinking: Vec<ThinkingBlock>,
}

/// One tool call emitted by the model in an assistant turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// JSON-encoded arguments. Kept as a string because providers
    /// stream arg deltas as strings; the recipient parses.
    pub args_json: String,
}

/// One reasoning / thinking block from the model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThinkingBlock {
    pub text: String,
    /// Anthropic's opaque verification token. Must round-trip.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// Codex reasoning `encrypted_content`, when the request asked
    /// for it via `include: ["reasoning.encrypted_content"]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_content: Option<String>,
}

impl Message {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: content.into(),
            ..Default::default()
        }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: content.into(),
            ..Default::default()
        }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".into(),
            content: content.into(),
            ..Default::default()
        }
    }
    /// Assistant message carrying tool_calls (and optionally text).
    pub fn assistant_with_tool_calls(
        content: impl Into<String>,
        tool_calls: Vec<ToolCall>,
        thinking: Vec<ThinkingBlock>,
    ) -> Self {
        Self {
            role: "assistant".into(),
            content: content.into(),
            tool_calls,
            thinking,
            tool_call_id: None,
        }
    }
    /// Tool-result message linked to an assistant tool_call by id.
    pub fn tool_result(tool_call_id: impl Into<String>, observation: impl Into<String>) -> Self {
        Self {
            role: "tool".into(),
            content: observation.into(),
            tool_call_id: Some(tool_call_id.into()),
            ..Default::default()
        }
    }
}

/// A pending LLM call, queued for the host to dispatch (possibly
/// batched with other entities' pending calls). The host resolves
/// `role` via the active Profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingLlmCall {
    pub role: String,
    pub messages: Vec<Message>,
}

/// A pending tool call. Similarly batchable at the host level.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingToolCall {
    pub name: String,
    pub args: Value,
}

/// Reference to a tool available to the current agent run. Populated
/// into `Entity.available_tools` by LoadTools (a host-side system
/// that calls `tool.list@1`). Consumed by CallLlm when building the
/// `llm.chat@1` request's `tools` field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinitionRef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toolset: Option<String>,
}

/// Module-specific parsed action. For ReACT this is
/// `{thought, tool_name, tool_args}`; for RLM `{thought, code}`; for
/// Predict the parsed output fields directly.
pub type ParsedAction = Value;

/// An entity is a sparse bag of typed components plus an opaque bag
/// of extension components.
#[derive(Debug, Default)]
pub struct Entity {
    // Creation-time
    pub run_id: Option<String>,
    pub identity: Option<Identity>,
    pub input: Option<Value>,
    pub bundle: Option<Bundle>,

    // Resolved
    pub profile: Option<Profile>,
    pub schedule: Option<crate::schedule::Schedule>,
    pub permissions: Option<Permissions>,

    // Running state
    pub trajectory: Vec<TrajectoryEvent>,
    pub current_messages: Option<Vec<Message>>,
    pub pending_llm_call: Option<PendingLlmCall>,
    pub last_llm_response: Option<String>,
    pub parsed_action: Option<ParsedAction>,
    pub pending_tool_call: Option<PendingToolCall>,
    pub last_observation: Option<String>,
    pub session_id: Option<String>,
    pub iter_counter: Option<IterCounter>,

    // Tool calling + reasoning (populated by CallLlm when the provider
    // returns them; read by host-side systems and by RenderPrompt).
    pub available_tools: Vec<ToolDefinitionRef>,
    pub pending_tool_calls: Vec<ToolCall>,
    pub last_thinking_blocks: Vec<ThinkingBlock>,

    // Terminal
    pub final_output: Option<Value>,
    pub error: Option<RunError>,

    /// Host-side systems may write extension components here. Core
    /// treats them as opaque and makes them available to downstream
    /// systems that declare them in their reads list.
    pub extensions: BTreeMap<String, Value>,
}

impl Entity {
    /// Is this entity terminal (Final or Error present)?
    pub fn is_terminal(&self) -> bool {
        self.final_output.is_some() || self.error.is_some()
    }

    /// Summarise what components this entity currently has, for query
    /// predicates on the host side.
    pub fn present_components(&self) -> Vec<ComponentName> {
        use ComponentName::*;
        let mut out = Vec::new();
        if self.run_id.is_some() {
            out.push(RunId);
        }
        if self.identity.is_some() {
            out.push(Identity);
        }
        if self.input.is_some() {
            out.push(Input);
        }
        if self.bundle.is_some() {
            out.push(Bundle);
        }
        if self.profile.is_some() {
            out.push(Profile);
        }
        if self.schedule.is_some() {
            out.push(Schedule);
        }
        if !self.trajectory.is_empty() {
            out.push(Trajectory);
        }
        if self.current_messages.is_some() {
            out.push(CurrentMessages);
        }
        if self.pending_llm_call.is_some() {
            out.push(PendingLlmCall);
        }
        if self.last_llm_response.is_some() {
            out.push(LastLlmResponse);
        }
        if self.parsed_action.is_some() {
            out.push(ParsedAction);
        }
        if self.pending_tool_call.is_some() {
            out.push(PendingToolCall);
        }
        if self.last_observation.is_some() {
            out.push(LastObservation);
        }
        if self.session_id.is_some() {
            out.push(SessionId);
        }
        if self.iter_counter.is_some() {
            out.push(IterCounter);
        }
        if !self.available_tools.is_empty() {
            out.push(AvailableTools);
        }
        if !self.pending_tool_calls.is_empty() {
            out.push(PendingToolCalls);
        }
        if !self.last_thinking_blocks.is_empty() {
            out.push(LastThinkingBlocks);
        }
        if self.final_output.is_some() {
            out.push(Final);
        }
        if self.error.is_some() {
            out.push(Error);
        }
        out
    }
}
