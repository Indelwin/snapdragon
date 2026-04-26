//! Host-side system fall-through protocol.
//!
//! When the runner encounters a system name it doesn't have in its
//! local registry, it dispatches to the host via
//! `call_capability("system.<name>@1", ...)`. This module defines the
//! JSON wire types for that exchange.
//!
//! Design intent: host-side systems are how wrappers (Bun, BEAM,
//! browser, future) add custom behaviour to the agent without touching
//! the core. ReACT's `DetectToolCall` and `InvokeTool` systems are the
//! first real users; future exotic types (speculation execution,
//! tree-of-thought, debate) slot in the same way.
//!
//! Sharp constraints on the protocol:
//!
//! 1. Trust-bearing components are NOT sent in the view and NOT
//!    accepted in writes: `bundle`, `identity`, `schedule`, `profile`.
//!    A host-side system that wants to change those needs to be
//!    promoted to a Rust-side system.
//!
//! 2. `trajectory` in writes is append-only — the runner appends the
//!    given events to the live trajectory; it never replaces.
//!
//! 3. `extensions` are freely readable and writable — this is the
//!    open namespace for host-owned components (design-v4 §3).

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::component::{Entity, IterCounter, Message, PendingToolCall};
use crate::trajectory::TrajectoryEvent;

/// Read-only snapshot of the entity sent to a host-side system. Keep
/// this narrow — anything extra added here is a forward-compat
/// constraint on every host-side system handler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityView {
    pub run_id: Option<String>,
    pub input: Option<Value>,
    pub current_messages: Option<Vec<Message>>,
    pub last_llm_response: Option<String>,
    pub parsed_action: Option<Value>,
    pub pending_tool_call: Option<PendingToolCall>,
    pub last_observation: Option<String>,
    pub session_id: Option<String>,
    pub iter_counter: Option<IterCounter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub available_tools: Vec<crate::component::ToolDefinitionRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pending_tool_calls: Vec<crate::component::ToolCall>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub last_thinking_blocks: Vec<crate::component::ThinkingBlock>,
    #[serde(default)]
    pub trajectory: Vec<TrajectoryEvent>,
    #[serde(default)]
    pub extensions: BTreeMap<String, Value>,
}

impl EntityView {
    pub fn from_entity(e: &Entity) -> Self {
        Self {
            run_id: e.run_id.clone(),
            input: e.input.clone(),
            current_messages: e.current_messages.clone(),
            last_llm_response: e.last_llm_response.clone(),
            parsed_action: e.parsed_action.clone(),
            pending_tool_call: e.pending_tool_call.clone(),
            last_observation: e.last_observation.clone(),
            session_id: e.session_id.clone(),
            iter_counter: e.iter_counter.clone(),
            available_tools: e.available_tools.clone(),
            pending_tool_calls: e.pending_tool_calls.clone(),
            last_thinking_blocks: e.last_thinking_blocks.clone(),
            trajectory: e.trajectory.clone(),
            extensions: e.extensions.clone(),
        }
    }
}

/// Request JSON for `system.<name>@1`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostSystemRequest {
    /// Pass-through from the schedule's `SystemInvocation.args`.
    #[serde(default)]
    pub args: Value,
    /// Read-only entity snapshot.
    pub view: EntityView,
}

/// What a host-side system may write back. Mirrors a subset of
/// `ComponentWrites`; everything optional.
///
/// `Option<Option<T>>` on `pending_tool_call` is the standard "three
/// state" — absent = no change, `Some(None)` = clear, `Some(Some(v))`
/// = set.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HostSystemWrites {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_messages: Option<Vec<Message>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_llm_response: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parsed_action: Option<Value>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "option_option"
    )]
    pub pending_tool_call: Option<Option<PendingToolCall>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_observation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iter_counter: Option<IterCounter>,
    /// Full list of tools available for subsequent CallLlm invocations.
    /// Populated by LoadTools. Replace-the-whole-list semantics;
    /// partial updates would require another flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_tools: Option<Vec<crate::component::ToolDefinitionRef>>,
    /// Tool calls the model wants invoked. Populated by CallLlm from
    /// the provider response; consumed by a host-side InvokeTool system.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_tool_calls: Option<Vec<crate::component::ToolCall>>,
    /// Reasoning blocks from the most recent assistant turn. Kept on
    /// the entity so RenderPrompt / InvokeTool can echo them back
    /// verbatim when the next assistant message carries tool_calls
    /// (required for Anthropic).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_thinking_blocks: Option<Vec<crate::component::ThinkingBlock>>,
    /// Events to append to the trajectory (append-only; host cannot
    /// replace existing events).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub trajectory_append: Vec<TrajectoryEvent>,
    /// Final output — presence terminates the run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_output: Option<Value>,
    /// Extension components to set. Absent keys are unchanged; a
    /// present key with null value clears that extension component.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: BTreeMap<String, Value>,
}

/// Control-flow signal from a host-side system.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HostSystemSignal {
    Finish,
    Abort { reason: String },
    Custom { name: String },
}

/// Response JSON from `system.<name>@1`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HostSystemResponse {
    #[serde(default)]
    pub writes: HostSystemWrites,
    /// Events to emit on the bus. Each is (topic, payload).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<(String, Value)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signal: Option<HostSystemSignal>,
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/// serde helper for `Option<Option<T>>` fields so we can distinguish
/// "no change" (field absent) from "clear" (field = null) on the wire.
mod option_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        v: &Option<Option<T>>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match v {
            None => s.serialize_none(),
            Some(None) => s.serialize_none(),
            Some(Some(inner)) => inner.serialize(s),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        let opt = Option::<T>::deserialize(d)?;
        // The field was present (caller only invokes this if the key
        // was in the payload), so we wrap one more level. `None` here
        // means the value was JSON null → "clear".
        Ok(Some(opt))
    }
}
