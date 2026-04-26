//! Built-in systems for v0.1 Predict runs.
//!
//! Each system is a `System` impl declaring its reads/writes and the
//! transform. The schedule references systems by their `name()`.
//!
//! - `ResolveProfile` — merges bundle default with `profile.get@1`.
//! - `ResolveSchedule` — placeholder; picks default or `schedule.resolve@1`.
//! - `RenderPrompt` — adapter.render over signature + inputs.
//! - `CallLlm` — `HostPipe::chat` with the resolved role.
//! - `ParseResponse` — adapter.parse into typed output JSON.
//! - `Finalize` — writes `final_output` from the parsed action.

use alloc::format;
use alloc::string::ToString;
use alloc::vec::Vec;
use serde_json::Value;

use crate::adapter::{Adapter, ChatAdapter, Message, render_structured_chat_prefix};
use crate::component::{ComponentName, Entity, PendingLlmCall};
use crate::error::RunError;
use crate::event::{self, Topic};
use crate::host::HostPipe;
use crate::profile::Profile;
use crate::schedule::Schedule;
use crate::system::{System, SystemDelta};

// --- ResolveProfile ------------------------------------------------------

pub struct ResolveProfileSystem;

impl System for ResolveProfileSystem {
    fn name(&self) -> &'static str {
        "ResolveProfile"
    }
    fn reads(&self) -> &'static [ComponentName] {
        &[ComponentName::Bundle]
    }
    fn writes(&self) -> &'static [ComponentName] {
        &[ComponentName::Profile]
    }

    fn run(
        &self,
        entity: &Entity,
        host: &dyn HostPipe,
        _args: &Value,
    ) -> Result<SystemDelta, RunError> {
        // Bundle default profile (from `default_profile` field, falling back to empty).
        let bundle_default = entity
            .bundle
            .as_ref()
            .and_then(|b| b.default_profile.clone())
            .unwrap_or_default();

        // Host override via profile.get@1. None means "use bundle default".
        let override_ = crate::capability::profile::get(host).map_err(|e| RunError::Internal {
            reason: format!("profile.get: {}", e),
        })?;

        let resolved = match override_ {
            Some(p) => Profile::merge(bundle_default, p),
            None => bundle_default,
        };

        let mut d = SystemDelta::default();
        d.writes.profile = Some(resolved);
        Ok(d)
    }
}

// --- ResolveSchedule -----------------------------------------------------

pub struct ResolveScheduleSystem;

impl System for ResolveScheduleSystem {
    fn name(&self) -> &'static str {
        "ResolveSchedule"
    }
    fn reads(&self) -> &'static [ComponentName] {
        &[ComponentName::Bundle, ComponentName::Profile]
    }
    fn writes(&self) -> &'static [ComponentName] {
        &[ComponentName::Schedule]
    }

    fn run(
        &self,
        entity: &Entity,
        _host: &dyn HostPipe,
        _args: &Value,
    ) -> Result<SystemDelta, RunError> {
        // v0.1: bundle-declared schedule if any, else Predict default.
        // schedule.resolve@1 host override lands when we need it.
        let schedule = entity
            .bundle
            .as_ref()
            .and_then(|b| b.schedule.clone())
            .unwrap_or_else(Schedule::predict_default);

        let mut d = SystemDelta::default();
        d.writes.schedule = Some(schedule);
        Ok(d)
    }
}

// --- RenderPrompt --------------------------------------------------------

pub struct RenderPromptSystem;

impl System for RenderPromptSystem {
    fn name(&self) -> &'static str {
        "RenderPrompt"
    }
    fn reads(&self) -> &'static [ComponentName] {
        &[
            ComponentName::Bundle,
            ComponentName::Profile,
            ComponentName::Input,
            ComponentName::Trajectory,
        ]
    }
    fn writes(&self) -> &'static [ComponentName] {
        &[ComponentName::CurrentMessages]
    }

    fn run(
        &self,
        entity: &Entity,
        _host: &dyn HostPipe,
        _args: &Value,
    ) -> Result<SystemDelta, RunError> {
        let bundle = entity.bundle.as_ref().ok_or(RunError::NoBundleLoaded)?;
        let input = entity
            .input
            .as_ref()
            .ok_or_else(|| RunError::InvalidInput {
                reason: "Input component missing".into(),
            })?;
        let signature = bundle
            .primary_signature()
            .ok_or_else(|| RunError::Internal {
                reason: "bundle has no signatures".into(),
            })?;

        let instructions = bundle
            .compiled
            .instructions_by_module
            .get("action")
            .cloned()
            .unwrap_or_default();
        let demos = bundle
            .compiled
            .demos_by_module
            .get("action")
            .cloned()
            .unwrap_or_default();

        let messages = if let Some(explicit_messages) = input.get("messages") {
            let mut prefix = render_structured_chat_prefix(signature, &instructions, &demos)
                .map_err(|e| RunError::Internal {
                    reason: format!("render: {:?}", e),
                })?;
            let mut explicit = serde_json::from_value::<Vec<Message>>(explicit_messages.clone())
                .map_err(|e| RunError::InvalidInput {
                    reason: format!("input.messages: {}", e),
                })?;
            prefix.append(&mut explicit);
            prefix
        } else {
            let adapter = ChatAdapter;
            adapter
                .render(signature, &instructions, &demos, input)
                .map_err(|e| RunError::Internal {
                    reason: format!("render: {:?}", e),
                })?
        };

        // Optional persona prefix from profile.
        let messages = match entity.profile.as_ref().and_then(|p| p.persona.as_ref()) {
            Some(persona) if !persona.is_empty() => {
                let mut out = Vec::with_capacity(messages.len() + 1);
                out.push(Message::system(persona.clone()));
                out.extend(messages.into_iter());
                out
            }
            _ => messages,
        };

        let mut d = SystemDelta::default();
        d.writes.current_messages = Some(messages);
        Ok(d)
    }
}

// --- CallLlm ------------------------------------------------------------

pub struct CallLlmSystem;

impl System for CallLlmSystem {
    fn name(&self) -> &'static str {
        "CallLlm"
    }
    fn reads(&self) -> &'static [ComponentName] {
        &[
            ComponentName::CurrentMessages,
            ComponentName::Profile,
            ComponentName::AvailableTools,
        ]
    }
    fn writes(&self) -> &'static [ComponentName] {
        &[
            ComponentName::LastLlmResponse,
            ComponentName::PendingLlmCall,
            ComponentName::PendingToolCalls,
            ComponentName::LastThinkingBlocks,
        ]
    }

    fn run(
        &self,
        entity: &Entity,
        host: &dyn HostPipe,
        _args: &Value,
    ) -> Result<SystemDelta, RunError> {
        let msgs = entity
            .current_messages
            .as_ref()
            .ok_or_else(|| RunError::Internal {
                reason: "CurrentMessages missing before CallLlm".into(),
            })?;
        let role = "action".to_string();

        let t0 = host.now_ms();
        event::emit(
            host,
            Topic::LlmRequestStarted,
            &event::LlmRequestStarted {
                role: &role,
                n_messages: msgs.len(),
            },
        );

        // Pending marker — useful for Layer 3 batching; cleared after return.
        let pending = PendingLlmCall {
            role: role.clone(),
            messages: msgs.clone(),
        };

        // Build the full chat request. When AvailableTools is non-empty
        // we pass tools + tool_choice=auto; the provider surfaces
        // function-call output via structured tool_calls on the
        // response. When empty we still go through the capability pipe
        // (not the hot-path WIT `chat` import) because reasoning output
        // needs the richer response shape too.
        let has_tools = !entity.available_tools.is_empty();
        let tools: Vec<crate::host::ToolDefinition> = entity
            .available_tools
            .iter()
            .map(|t| crate::host::ToolDefinition {
                name: t.name.clone(),
                description: t.description.clone(),
                parameters: t.parameters.clone(),
            })
            .collect();
        let tool_choice = if has_tools {
            Some(crate::host::ToolChoice::Mode("auto".into()))
        } else {
            None
        };

        // Pull reasoning config from the bundle metadata. Shape:
        // `metadata.reasoning: { enabled?, effort?, budget_tokens?, summary? }`.
        // A bundle that sets this makes every CallLlm invocation
        // request reasoning from the provider.
        let reasoning = entity
            .bundle
            .as_ref()
            .and_then(|b| b.metadata.get("reasoning"))
            .and_then(|v| serde_json::from_value::<crate::host::ReasoningRequest>(v.clone()).ok());

        let req = crate::host::ChatRequest {
            role: role.clone(),
            messages: msgs.clone(),
            tools,
            tool_choice,
            reasoning,
            temperature: None,
            max_tokens: None,
            stop: Vec::new(),
        };
        let resp = host.chat_rich(&req).map_err(|e| RunError::Internal {
            reason: format!("chat: {}", e),
        })?;

        let elapsed = host.now_ms().saturating_sub(t0);
        event::emit(
            host,
            Topic::LlmRequestCompleted,
            &event::LlmRequestCompleted {
                role: &role,
                duration_ms: elapsed,
                response_len: resp.content.len(),
            },
        );

        let mut d = SystemDelta::default();
        d.writes.pending_llm_call = Some(Some(pending)); // set
        d.writes.last_llm_response = Some(resp.content);
        // Eagerly clear pending on success so downstream systems see it gone.
        d.writes.pending_llm_call = Some(None);
        // Structured tool calls + thinking, routed through components
        // for host-side systems (detect_tool_call, invoke_tool) to pick
        // up. Always write — replaces any previous turn's values.
        d.writes.pending_tool_calls = Some(resp.tool_calls);
        d.writes.last_thinking_blocks = Some(resp.thinking);
        Ok(d)
    }
}

// --- ParseResponse -------------------------------------------------------

pub struct ParseResponseSystem;

impl System for ParseResponseSystem {
    fn name(&self) -> &'static str {
        "ParseResponse"
    }
    fn reads(&self) -> &'static [ComponentName] {
        &[ComponentName::LastLlmResponse, ComponentName::Bundle]
    }
    fn writes(&self) -> &'static [ComponentName] {
        &[ComponentName::ParsedAction]
    }

    fn run(
        &self,
        entity: &Entity,
        host: &dyn HostPipe,
        _args: &Value,
    ) -> Result<SystemDelta, RunError> {
        // When the model's response is a structured tool call (populated
        // into PendingToolCalls by CallLlm), there's nothing to parse —
        // the host-side InvokeTool system will consume the call and
        // this system gets re-run on a later turn with real text. Skip.
        if !entity.pending_tool_calls.is_empty() {
            return Ok(SystemDelta::default());
        }
        let response = entity
            .last_llm_response
            .as_ref()
            .ok_or_else(|| RunError::Internal {
                reason: "LastLlmResponse missing before ParseResponse".into(),
            })?;
        let bundle = entity.bundle.as_ref().ok_or(RunError::NoBundleLoaded)?;
        let signature = bundle
            .primary_signature()
            .ok_or_else(|| RunError::Internal {
                reason: "bundle has no signatures".into(),
            })?;

        let adapter = ChatAdapter;
        match adapter.parse(signature, response) {
            Ok(parsed) => {
                let mut d = SystemDelta::default();
                d.writes.parsed_action = Some(parsed);
                Ok(d)
            }
            Err(e) => {
                event::emit_raw(
                    host,
                    Topic::LlmParseFailed.as_str(),
                    &format!(r#"{{"error":"{}"}}"#, e),
                );
                Err(RunError::LlmParseFailed {
                    attempts: 1,
                    last_error: format!("{}", e),
                })
            }
        }
    }
}

// --- Finalize ------------------------------------------------------------

pub struct FinalizeSystem;

impl System for FinalizeSystem {
    fn name(&self) -> &'static str {
        "Finalize"
    }
    fn reads(&self) -> &'static [ComponentName] {
        &[ComponentName::ParsedAction]
    }
    fn writes(&self) -> &'static [ComponentName] {
        &[ComponentName::Final]
    }

    fn run(
        &self,
        entity: &Entity,
        _host: &dyn HostPipe,
        _args: &Value,
    ) -> Result<SystemDelta, RunError> {
        // If a tool-call round-trip is pending we have no parsed action
        // to finalize. This is the ReACT shape: Finalize sits after the
        // tool loop and only runs once the model has produced a real
        // reply.
        if !entity.pending_tool_calls.is_empty() {
            return Ok(SystemDelta::default());
        }
        let parsed = entity
            .parsed_action
            .as_ref()
            .ok_or_else(|| RunError::Internal {
                reason: "ParsedAction missing before Finalize".into(),
            })?;

        let mut d = SystemDelta::default();
        d.writes.final_output = Some(parsed.clone());
        Ok(d)
    }
}

// --- Hook ----------------------------------------------------------------

/// Generic `Hook` system. Args: `{"hook": "<hook name without prefix>"}`.
/// Dispatches to the named hook via the capability pipe; identity
/// pass-through if the host didn't register. On `before_llm_request`,
/// reads `CurrentMessages` and (optionally) rewrites them. On
/// `after_llm_response`, reads `LastLlmResponse` and optionally
/// rewrites it. Other hooks are recognised but pass through in v0.1.
pub struct HookSystem;

impl System for HookSystem {
    fn name(&self) -> &'static str {
        "Hook"
    }
    fn reads(&self) -> &'static [ComponentName] {
        &[
            ComponentName::CurrentMessages,
            ComponentName::LastLlmResponse,
        ]
    }
    fn writes(&self) -> &'static [ComponentName] {
        &[
            ComponentName::CurrentMessages,
            ComponentName::LastLlmResponse,
        ]
    }

    fn run(
        &self,
        entity: &Entity,
        host: &dyn HostPipe,
        args: &Value,
    ) -> Result<SystemDelta, RunError> {
        let hook_name = args.get("hook").and_then(|v| v.as_str()).unwrap_or("");
        let module_id = entity
            .bundle
            .as_ref()
            .map(|b| b.program_id.as_str())
            .unwrap_or("unknown");
        let iter = entity.iter_counter.as_ref().map(|c| c.iter).unwrap_or(0);

        let mut d = SystemDelta::default();

        match hook_name {
            "before_llm_request" => {
                if let Some(messages) = &entity.current_messages {
                    let req = crate::hook::BeforeLlmRequestReq {
                        module_id,
                        iter,
                        messages,
                    };
                    match crate::hook::invoke::<_, crate::hook::BeforeLlmRequestPatch>(
                        host,
                        crate::hook::Hook::BeforeLlmRequest,
                        &req,
                    ) {
                        Ok(crate::hook::HookOutcome::Patch(patch)) => {
                            d.writes.current_messages = Some(patch.messages);
                        }
                        Ok(crate::hook::HookOutcome::Abort(reason)) => {
                            return Err(RunError::HookAborted {
                                hook: "before_llm_request".into(),
                                reason,
                            });
                        }
                        _ => {} // no change
                    }
                }
            }
            "after_llm_response" => {
                if let Some(raw) = entity.last_llm_response.as_deref() {
                    let req = crate::hook::AfterLlmResponseReq {
                        module_id,
                        iter,
                        raw_response: raw,
                    };
                    match crate::hook::invoke::<_, crate::hook::AfterLlmResponsePatch>(
                        host,
                        crate::hook::Hook::AfterLlmResponse,
                        &req,
                    ) {
                        Ok(crate::hook::HookOutcome::Patch(patch)) => {
                            d.writes.last_llm_response = Some(patch.raw_response);
                        }
                        Ok(crate::hook::HookOutcome::Abort(reason)) => {
                            return Err(RunError::HookAborted {
                                hook: "after_llm_response".into(),
                                reason,
                            });
                        }
                        _ => {} // no change
                    }
                }
            }
            // Other hook slots recognised but pass through in v0.1.
            "before_tool_invoke" | "after_tool_invoke" | "before_iter" | "before_finalize" => {}
            _ => {}
        }

        Ok(d)
    }
}

// --- Tests ---------------------------------------------------------------

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::*;
    use crate::bundle::{Bundle, Compiled};
    use crate::host::mock::MockHostPipe;
    use crate::signature::{Field, FieldType, Signature};

    fn mini_bundle() -> Bundle {
        Bundle {
            schema: 1,
            program_id: "classify".into(),
            program_version: "0.1.0".into(),
            signatures: vec![Signature {
                name: "Classify".into(),
                doc: Some("Classify the query.".into()),
                inputs: vec![Field {
                    name: "query".into(),
                    ty: FieldType::String,
                    doc: None,
                }],
                outputs: vec![Field {
                    name: "intent".into(),
                    ty: FieldType::Enum {
                        values: vec!["search".into(), "chat".into()],
                    },
                    doc: None,
                }],
            }],
            default_profile: None,
            schedule: None,
            requires: vec![],
            compiled: Compiled {
                instructions_by_module: {
                    let mut m = std::collections::BTreeMap::new();
                    m.insert("action".into(), "You classify queries.".into());
                    m
                },
                demos_by_module: Default::default(),
            },
            metadata: Default::default(),
        }
    }

    #[test]
    fn resolve_profile_uses_host_override_when_present() {
        let host = MockHostPipe::new();
        host.enqueue_ok("profile.get@1", r#"{"persona":"acme-bot"}"#);

        let mut entity = Entity::default();
        entity.bundle = Some(mini_bundle());

        let delta = ResolveProfileSystem
            .run(&entity, &host, &Value::Null)
            .unwrap();
        let p = delta.writes.profile.unwrap();
        assert_eq!(p.persona.as_deref(), Some("acme-bot"));
    }

    #[test]
    fn resolve_profile_falls_back_on_no_handler() {
        let host = MockHostPipe::new(); // nothing queued
        let mut entity = Entity::default();
        entity.bundle = Some(mini_bundle());

        let delta = ResolveProfileSystem
            .run(&entity, &host, &Value::Null)
            .unwrap();
        assert!(delta.writes.profile.is_some());
    }

    #[test]
    fn render_prompt_produces_system_plus_user() {
        let host = MockHostPipe::new();
        let mut entity = Entity::default();
        entity.bundle = Some(mini_bundle());
        entity.input = Some(serde_json::json!({ "query": "hi" }));

        let delta = RenderPromptSystem
            .run(&entity, &host, &Value::Null)
            .unwrap();
        let msgs = delta.writes.current_messages.unwrap();
        assert!(msgs.len() >= 2);
        assert_eq!(msgs[0].role, "system");
        assert_eq!(msgs.last().unwrap().role, "user");
    }

    #[test]
    fn render_prompt_prefers_input_messages_when_present() {
        let host = MockHostPipe::new();
        let mut entity = Entity::default();
        entity.bundle = Some(mini_bundle());
        entity.input = Some(serde_json::json!({
            "query": "legacy fallback",
            "messages": [
                { "role": "user", "content": "first question" },
                { "role": "assistant", "content": "first answer" },
                { "role": "user", "content": "follow-up" }
            ]
        }));

        let delta = RenderPromptSystem
            .run(&entity, &host, &Value::Null)
            .unwrap();
        let msgs = delta.writes.current_messages.unwrap();
        assert!(msgs.len() >= 4);
        assert_eq!(msgs[0].role, "system");
        assert!(!msgs[0].content.contains("[[ ## query ## ]]"));
        assert!(msgs[0].content.contains("[[ ## intent ## ]]"));
        assert_eq!(msgs[1].role, "user");
        assert_eq!(msgs[1].content, "first question");
        assert_eq!(msgs[2].role, "assistant");
        assert_eq!(msgs[2].content, "first answer");
        assert_eq!(msgs[3].role, "user");
        assert_eq!(msgs[3].content, "follow-up");
        assert!(!msgs[1].content.contains("[[ ## query ## ]]"));
    }

    #[test]
    fn call_llm_uses_host_chat_queue() {
        let host = MockHostPipe::new();
        host.enqueue_chat("[[ ## intent ## ]]\nsearch\n\n[[ ## completed ## ]]");

        let mut entity = Entity::default();
        entity.current_messages = Some(vec![Message::user("hi")]);

        let delta = CallLlmSystem.run(&entity, &host, &Value::Null).unwrap();
        let resp = delta.writes.last_llm_response.unwrap();
        assert!(resp.contains("search"));
        assert_eq!(host.event_count("llm.request."), 2);
    }

    #[test]
    fn parse_response_happy_path() {
        let host = MockHostPipe::new();
        let mut entity = Entity::default();
        entity.bundle = Some(mini_bundle());
        entity.last_llm_response =
            Some("[[ ## intent ## ]]\nsearch\n\n[[ ## completed ## ]]".into());

        let delta = ParseResponseSystem
            .run(&entity, &host, &Value::Null)
            .unwrap();
        let parsed = delta.writes.parsed_action.unwrap();
        assert_eq!(parsed, serde_json::json!({ "intent": "search" }));
    }

    #[test]
    fn finalize_copies_parsed_action() {
        let host = MockHostPipe::new();
        let mut entity = Entity::default();
        entity.parsed_action = Some(serde_json::json!({ "intent": "chat" }));

        let delta = FinalizeSystem.run(&entity, &host, &Value::Null).unwrap();
        let fin = delta.writes.final_output.unwrap();
        assert_eq!(fin, serde_json::json!({ "intent": "chat" }));
    }
}
