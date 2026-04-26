//! HostPipe — the abstraction over the two-pipe WIT ABI.
//!
//! Everything in the core that wants to talk to the host does it
//! through `&dyn HostPipe`. This gives us:
//!   1. A single, typed seam between core logic and the WIT imports.
//!   2. Trivial mocking in tests — `MockHostPipe` implements the same
//!      trait and runs entirely in-process.
//!   3. Clean failure paths. A capability miss returns a typed
//!      `CallError::NotProvided` rather than a regex over the error
//!      string, and the HostPipe normalises it before the caller sees
//!      it.
//!
//! The real implementation (`WitHostPipe`) just forwards calls to
//! `wit::snapdragon::agent::host::*`. It's what the compiled WASM
//! component uses at runtime.

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

use crate::component::Message;

/// Typed, classified error from a host call. Distinct from
/// `RunError` — a `CallError` is the "what the host told us" layer;
/// `RunError` is the "what the agent decided to do about it" layer.
#[derive(Debug, Clone)]
pub enum CallError {
    /// The host has no handler for this capability. Agents typically
    /// treat this as "degrade gracefully", not a fatal error.
    NotProvided { cap: String },
    /// The host's handler returned an err arm with this message.
    Host(String),
    /// Request/response JSON shape didn't match expectations.
    Serde(String),
}

impl CallError {
    pub fn is_not_provided(&self) -> bool {
        matches!(self, CallError::NotProvided { .. })
    }
}

impl core::fmt::Display for CallError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::NotProvided { cap } => write!(f, "capability not provided: {}", cap),
            Self::Host(m)             => write!(f, "host error: {}", m),
            Self::Serde(m)            => write!(f, "serde: {}", m),
        }
    }
}

/// The single abstraction over everything the host exposes to the core.
pub trait HostPipe {
    /// Raw capability call. `cap` is a versioned name like
    /// `"llm.chat@1"` or `"tool.invoke:web_search@1"`. Implementations
    /// MUST translate the `capability_not_provided` sentinel into
    /// `CallError::NotProvided` rather than letting it leak as `Host`.
    fn call_capability(&self, cap: &str, request_json: &str) -> Result<String, CallError>;

    /// Fire-and-forget event emission. Implementations must not fail;
    /// if the host's event pipe is broken, that's the host's problem.
    fn emit_event(&self, topic: &str, payload_json: &str);

    /// Typed hot-path wrapper for `llm.chat@1` — text-only, no tools,
    /// no reasoning. Default impl routes through `call_capability`;
    /// the WIT-backed impl overrides to use the typed `chat` import.
    ///
    /// Callers that need to pass tools or reasoning, or read tool_calls
    /// or thinking blocks out of the response, should use
    /// [`HostPipe::chat_rich`] instead.
    fn chat(&self, role: &str, msgs: &[Message]) -> Result<ChatResponse, CallError> {
        let req = ChatRequest {
            role: role.into(),
            messages: msgs.to_vec(),
            ..Default::default()
        };
        self.chat_rich(&req)
    }

    /// Full `llm.chat@1` call with tools, tool_choice, and reasoning
    /// requests. Always goes through `call_capability` — the WIT typed
    /// `chat` import can't carry the extended shape. The modest JSON
    /// overhead is acceptable because this is the path ReACT and
    /// reasoning-enabled bundles use, which are the slow paths anyway.
    fn chat_rich(&self, req: &ChatRequest) -> Result<ChatResponse, CallError> {
        let json = serde_json::to_string(req).map_err(|e| CallError::Serde(e.to_string()))?;
        let resp = self.call_capability("llm.chat@1", &json)?;
        serde_json::from_str::<ChatResponse>(&resp).map_err(|e| CallError::Serde(e.to_string()))
    }

    /// Wall clock, unix milliseconds. Replay-essential; separate
    /// function so hosts can substitute a fixed clock.
    fn now_ms(&self) -> u64;

    /// Cryptographic randomness. Must return exactly `len` bytes.
    fn random_bytes(&self, len: u32) -> Vec<u8>;
}

/// Request body for `llm.chat@1`. Matches the canonical schema in
/// `capabilities/llm.chat.v1.schema.json`.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ChatRequest {
    pub role:     String,
    pub messages: Vec<Message>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools:    Vec<ToolDefinition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning:   Option<ReasoningRequest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens:  Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stop:        Vec<String>,
}

/// Tool definition sent to the model in a `llm.chat@1` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name:        String,
    pub description: String,
    /// JSON Schema for the tool's args.
    pub parameters:  serde_json::Value,
}

/// Force / allow / restrict tool selection. Providers vary in support;
/// wrappers translate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolChoice {
    Mode(String), // "auto" | "any" | "none"
    Function { #[serde(rename = "type")] kind: String, name: String },
}

/// Per-call reasoning request.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReasoningRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled:       Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort:        Option<String>, // "low" | "medium" | "high" | "max"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary:       Option<String>, // "auto" | "concise" | "detailed"
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content:       String,
    #[serde(default)]
    pub tool_calls:    Vec<crate::component::ToolCall>,
    #[serde(default)]
    pub thinking:      Vec<crate::component::ThinkingBlock>,
    #[serde(default)]
    pub tokens_in:         Option<u32>,
    #[serde(default)]
    pub tokens_out:        Option<u32>,
    #[serde(default)]
    pub cache_read_tokens: Option<u32>,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

// ---- The real impl, over the WIT bindings ------------------------------

/// The production `HostPipe`. Calls directly into the wit-bindgen
/// generated host-import shims.
pub struct WitHostPipe;

impl HostPipe for WitHostPipe {
    fn call_capability(&self, cap: &str, request_json: &str) -> Result<String, CallError> {
        match crate::wit::snapdragon::agent::host::call_capability(cap, request_json) {
            Ok(s) => Ok(s),
            Err(msg) => {
                if msg.contains("capability_not_provided") {
                    Err(CallError::NotProvided { cap: cap.to_string() })
                } else {
                    Err(CallError::Host(msg))
                }
            }
        }
    }

    fn emit_event(&self, topic: &str, payload_json: &str) {
        crate::wit::snapdragon::agent::host::emit_event(topic, payload_json);
    }

    fn chat(&self, role: &str, msgs: &[Message]) -> Result<ChatResponse, CallError> {
        // Override: go through the typed WIT import rather than the
        // generic capability pipe. Saves two JSON trips per call.
        let wit_msgs: Vec<crate::wit::snapdragon::agent::host::Message> = msgs
            .iter()
            .map(|m| crate::wit::snapdragon::agent::host::Message {
                role:    m.role.clone(),
                content: m.content.clone(),
            })
            .collect();
        match crate::wit::snapdragon::agent::host::chat(role, &wit_msgs) {
            Ok(content) => Ok(ChatResponse {
                content,
                ..Default::default()
            }),
            Err(msg) => Err(CallError::Host(msg)),
        }
    }

    fn now_ms(&self) -> u64 {
        crate::wit::snapdragon::agent::host::now()
    }

    fn random_bytes(&self, len: u32) -> Vec<u8> {
        crate::wit::snapdragon::agent::host::random(len)
    }
}

// ---- Mock HostPipe for unit + integration tests ------------------------

/// A HostPipe you can hand canned responses to. For tests only; gated
/// behind the `std` feature because it uses interior mutability via
/// `std::sync::Mutex`. A `no_std` test variant can follow if/when we
/// need it.
#[cfg(feature = "std")]
pub mod mock {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// Script-driven mock. Pre-queue responses for each capability.
    /// Unqueued capability calls return `NotProvided` by default.
    /// All events are captured for assertion.
    pub struct MockHostPipe {
        /// cap -> queued responses (each is the JSON the host would return
        /// from its handler, or an Err(String) to simulate host failure).
        pub responses: Mutex<std::collections::HashMap<String, VecDeque<MockResponse>>>,
        /// Typed chat responses queued in order.
        pub chat_queue: Mutex<VecDeque<ChatResponse>>,
        /// Events captured in order.
        pub events: Mutex<Vec<(String, String)>>,
        /// Fixed clock value returned from `now_ms`.
        pub clock: Mutex<u64>,
        /// Fixed RNG seed — returns `rand_buf[0..len]`, cycling.
        pub rand_buf: Mutex<Vec<u8>>,
    }

    pub enum MockResponse {
        Ok(String),
        Err(CallError),
    }

    impl Default for MockHostPipe {
        fn default() -> Self {
            Self {
                responses:  Mutex::new(Default::default()),
                chat_queue: Mutex::new(VecDeque::new()),
                events:     Mutex::new(Vec::new()),
                clock:      Mutex::new(0),
                rand_buf:   Mutex::new(vec![0u8; 16]),
            }
        }
    }

    impl MockHostPipe {
        pub fn new() -> Self { Default::default() }

        /// Queue a JSON response for the next call to `cap`.
        pub fn enqueue_ok(&self, cap: &str, resp_json: impl Into<String>) -> &Self {
            self.responses
                .lock()
                .unwrap()
                .entry(cap.to_string())
                .or_default()
                .push_back(MockResponse::Ok(resp_json.into()));
            self
        }

        /// Queue a typed chat response (for the `chat` hot path).
        pub fn enqueue_chat(&self, content: impl Into<String>) -> &Self {
            self.chat_queue.lock().unwrap().push_back(ChatResponse {
                content: content.into(),
                ..Default::default()
            });
            self
        }

        /// Queue a chat response that includes tool_calls. For testing
        /// native-function-calling paths through a mock host.
        pub fn enqueue_chat_with_tool_calls(
            &self,
            content: impl Into<String>,
            tool_calls: Vec<crate::component::ToolCall>,
        ) -> &Self {
            self.chat_queue.lock().unwrap().push_back(ChatResponse {
                content: content.into(),
                tool_calls,
                finish_reason: Some("tool_calls".into()),
                ..Default::default()
            });
            self
        }

        /// Take a snapshot of events emitted so far.
        pub fn events_snapshot(&self) -> Vec<(String, String)> {
            self.events.lock().unwrap().clone()
        }

        /// Count events matching a topic prefix.
        pub fn event_count(&self, topic_prefix: &str) -> usize {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter(|(t, _)| t.starts_with(topic_prefix))
                .count()
        }
    }

    impl HostPipe for MockHostPipe {
        fn call_capability(&self, cap: &str, _request_json: &str) -> Result<String, CallError> {
            // For llm.chat@1, first check the generic responses map;
            // if nothing's queued there fall back to the typed chat_queue
            // so tests can use `enqueue_chat` / `enqueue_chat_with_tool_calls`
            // without pre-serialising.
            if cap == "llm.chat@1" {
                let mut map = self.responses.lock().unwrap();
                if let Some(q) = map.get_mut(cap) {
                    if let Some(resp) = q.pop_front() {
                        return match resp {
                            MockResponse::Ok(s)  => Ok(s),
                            MockResponse::Err(e) => Err(e),
                        };
                    }
                }
                drop(map);
                if let Some(r) = self.chat_queue.lock().unwrap().pop_front() {
                    return serde_json::to_string(&r)
                        .map_err(|e| CallError::Serde(e.to_string()));
                }
                return Err(CallError::NotProvided { cap: cap.to_string() });
            }
            let mut map = self.responses.lock().unwrap();
            let queue = map.get_mut(cap);
            match queue.and_then(|q| q.pop_front()) {
                Some(MockResponse::Ok(s))   => Ok(s),
                Some(MockResponse::Err(e))  => Err(e),
                None => Err(CallError::NotProvided { cap: cap.to_string() }),
            }
        }

        fn emit_event(&self, topic: &str, payload_json: &str) {
            self.events
                .lock()
                .unwrap()
                .push((topic.to_string(), payload_json.to_string()));
        }

        fn chat(&self, _role: &str, _msgs: &[Message]) -> Result<ChatResponse, CallError> {
            match self.chat_queue.lock().unwrap().pop_front() {
                Some(r) => Ok(r),
                None    => Err(CallError::NotProvided { cap: "llm.chat@1".into() }),
            }
        }

        fn chat_rich(&self, _req: &ChatRequest) -> Result<ChatResponse, CallError> {
            match self.chat_queue.lock().unwrap().pop_front() {
                Some(r) => Ok(r),
                None    => Err(CallError::NotProvided { cap: "llm.chat@1".into() }),
            }
        }

        fn now_ms(&self) -> u64 {
            *self.clock.lock().unwrap()
        }

        fn random_bytes(&self, len: u32) -> Vec<u8> {
            let buf = self.rand_buf.lock().unwrap();
            if buf.is_empty() { return vec![0u8; len as usize]; }
            let mut out = Vec::with_capacity(len as usize);
            for i in 0..len as usize {
                out.push(buf[i % buf.len()]);
            }
            out
        }
    }
}

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::mock::MockHostPipe;
    use super::*;

    #[test]
    fn unqueued_call_is_not_provided() {
        let host = MockHostPipe::new();
        let err = host.call_capability("memory.prefetch@1", "{}").unwrap_err();
        assert!(err.is_not_provided());
    }

    #[test]
    fn enqueued_response_returns_in_order() {
        let host = MockHostPipe::new();
        host.enqueue_ok("profile.get@1", r#"{}"#)
            .enqueue_ok("profile.get@1", r#"{"persona":"x"}"#);
        assert_eq!(host.call_capability("profile.get@1", "{}").unwrap(), "{}");
        assert_eq!(
            host.call_capability("profile.get@1", "{}").unwrap(),
            r#"{"persona":"x"}"#
        );
        // Third call: queue empty.
        assert!(host
            .call_capability("profile.get@1", "{}")
            .unwrap_err()
            .is_not_provided());
    }

    #[test]
    fn events_are_captured() {
        let host = MockHostPipe::new();
        host.emit_event("agent.run.started", r#"{"a":1}"#);
        host.emit_event("agent.run.completed", r#"{"b":2}"#);
        assert_eq!(host.event_count("agent."), 2);
        assert_eq!(host.event_count("agent.run.completed"), 1);
    }

    #[test]
    fn chat_queue_is_typed() {
        let host = MockHostPipe::new();
        host.enqueue_chat("hello");
        let r = host.chat("action", &[]).unwrap();
        assert_eq!(r.content, "hello");
    }
}
