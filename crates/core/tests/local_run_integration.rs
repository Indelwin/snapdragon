use snapdragon_core::bundle::{Bundle, Compiled};
use snapdragon_core::component::Message;
use snapdragon_core::host::{CallError, ChatRequest, ChatResponse, HostPipe};
use snapdragon_core::profile::Profile;
use snapdragon_core::signature::{Field, FieldType, Signature};
use std::collections::BTreeMap;
use std::sync::Mutex;

fn classify_bundle() -> Bundle {
    Bundle {
        schema: 1,
        program_id: "classify".into(),
        program_version: "0.1.0".into(),
        signatures: vec![Signature {
            name: "Classify".into(),
            doc: Some("Classify the query into an intent.".into()),
            inputs: vec![Field {
                name: "query".into(),
                ty: FieldType::String,
                doc: None,
            }],
            outputs: vec![Field {
                name: "intent".into(),
                ty: FieldType::Enum {
                    values: vec!["search".into(), "chat".into(), "tool".into()],
                },
                doc: None,
            }],
        }],
        default_profile: None,
        schedule: None,
        requires: vec![],
        compiled: Compiled {
            instructions_by_module: {
                let mut m = BTreeMap::new();
                m.insert("action".into(), "Classify the query.".into());
                m
            },
            demos_by_module: Default::default(),
        },
        metadata: Default::default(),
    }
}

#[derive(Default)]
struct ContextAwareHost {
    stack: Mutex<Vec<(Option<String>, Option<Profile>)>>,
    seen: Mutex<Vec<(Option<String>, Option<String>)>>,
}

impl ContextAwareHost {
    fn seen_contexts(&self) -> Vec<(Option<String>, Option<String>)> {
        self.seen.lock().unwrap().clone()
    }

    fn stack_depth(&self) -> usize {
        self.stack.lock().unwrap().len()
    }
}

impl HostPipe for ContextAwareHost {
    fn call_capability(&self, cap: &str, request_json: &str) -> Result<String, CallError> {
        match cap {
            "runtime.push_context@1" => {
                let req: serde_json::Value = serde_json::from_str(request_json)
                    .map_err(|e| CallError::Serde(e.to_string()))?;
                let run_id = req
                    .get("run_id")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string());
                let profile = match req.get("profile") {
                    Some(value) if !value.is_null() => Some(
                        serde_json::from_value::<Profile>(value.clone())
                            .map_err(|e| CallError::Serde(e.to_string()))?,
                    ),
                    _ => None,
                };
                self.stack.lock().unwrap().push((run_id, profile));
                Ok("{}".into())
            }
            "runtime.pop_context@1" => {
                self.stack.lock().unwrap().pop();
                Ok("{}".into())
            }
            _ => Err(CallError::NotProvided {
                cap: cap.to_string(),
            }),
        }
    }

    fn emit_event(&self, _topic: &str, _payload_json: &str) {}

    fn chat(&self, _role: &str, _msgs: &[Message]) -> Result<ChatResponse, CallError> {
        Ok(ChatResponse {
            content: "[[ ## intent ## ]]\nchat\n\n[[ ## completed ## ]]\n".into(),
            ..Default::default()
        })
    }

    fn chat_rich(&self, _req: &ChatRequest) -> Result<ChatResponse, CallError> {
        let snapshot = self
            .stack
            .lock()
            .unwrap()
            .last()
            .cloned()
            .unwrap_or((None, None));
        self.seen
            .lock()
            .unwrap()
            .push((snapshot.0, snapshot.1.and_then(|profile| profile.persona)));
        Ok(ChatResponse {
            content: "[[ ## intent ## ]]\nchat\n\n[[ ## completed ## ]]\n".into(),
            ..Default::default()
        })
    }

    fn now_ms(&self) -> u64 {
        123
    }

    fn random_bytes(&self, len: u32) -> Vec<u8> {
        vec![0; len as usize]
    }
}

#[test]
fn local_run_pushes_child_context_and_restores_after_completion() {
    snapdragon_core::install_bundle_for_test(classify_bundle());
    let host = ContextAwareHost::default();

    let out = snapdragon_core::run_local_with_host(
        &host,
        &serde_json::json!({
            "input": { "query": "hello" },
            "profile": { "persona": "local-reviewer" },
            "run_id": "child_local_1"
        })
        .to_string(),
    )
    .expect("local run should succeed");

    assert_eq!(out, serde_json::json!({ "intent": "chat" }));
    assert_eq!(
        host.seen_contexts(),
        vec![(Some("child_local_1".into()), Some("local-reviewer".into()))]
    );
    assert_eq!(host.stack_depth(), 0);
}
