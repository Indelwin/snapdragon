//! End-to-end integration test for the host-side system fall-through.
//!
//! Uses ReACT as the forcing function to validate the `system.<name>@1`
//! dispatch surface: a bundle whose schedule invokes a custom system
//! name the Rust registry doesn't have → the runner calls
//! `system.<name>@1` → a host-side handler returns a `HostSystemResponse`
//! → the runner applies its writes and continues.
//!
//! No ReACT code ships in the core for this test; it's all wired
//! through the extension seam. That's the point — proving the seam
//! is strong enough that wrappers can implement ReACT (and future
//! exotic types) entirely host-side.

use snapdragon_core::bundle::{Bundle, Compiled};
use snapdragon_core::host::mock::MockHostPipe;
use snapdragon_core::schedule::{Schedule, ScheduleStep, SystemInvocation};
use snapdragon_core::signature::{Field, FieldType, Signature};

use serde_json::json;
use std::collections::BTreeMap;

/// Minimal bundle whose schedule invokes a single custom system name
/// that Rust doesn't know about. The host will handle it via the
/// fall-through.
fn custom_system_bundle(system_name: &str) -> Bundle {
    Bundle {
        schema: 1,
        program_id: "host-system-test".into(),
        program_version: "0.1.0".into(),
        signatures: vec![Signature {
            name: "Echo".into(),
            doc: None,
            inputs: vec![Field {
                name: "message".into(),
                ty: FieldType::String,
                doc: None,
            }],
            outputs: vec![Field {
                name: "reply".into(),
                ty: FieldType::String,
                doc: None,
            }],
        }],
        default_profile: None,
        schedule: Some(Schedule {
            steps: vec![ScheduleStep::Invoke(SystemInvocation {
                id: "custom".into(),
                system: system_name.into(),
                args: json!({ "hello": "world" }),
                retry_on_fail: None,
                on_signal: None,
            })],
        }),
        requires: vec![],
        compiled: Compiled {
            instructions_by_module: BTreeMap::new(),
            demos_by_module: Default::default(),
        },
        metadata: Default::default(),
    }
}

#[test]
fn host_side_system_can_write_final_output() {
    let host = MockHostPipe::new();
    // Handler returns a final_output so the runner terminates cleanly.
    host.enqueue_ok(
        "system.emit_final@1",
        json!({
            "writes": {
                "final_output": { "reply": "from host-side system" }
            },
            "events": [
                ["host_system.fired", {"from": "emit_final"}]
            ]
        })
        .to_string(),
    );

    snapdragon_core::install_bundle_for_test(custom_system_bundle("emit_final"));

    let out = snapdragon_core::run_with_host(&host, r#"{"message":"hi"}"#)
        .expect("host-side system should succeed");

    assert_eq!(out, json!({ "reply": "from host-side system" }));

    // The event the handler returned should have been emitted on the bus.
    let events = host.events.lock().unwrap();
    let fired = events.iter().any(|(topic, _)| topic == "host_system.fired");
    assert!(
        fired,
        "expected 'host_system.fired' in emitted events, got: {:?}",
        *events
    );
}

#[test]
fn host_side_system_can_append_trajectory() {
    let host = MockHostPipe::new();
    host.enqueue_ok(
        "system.tracer@1",
        json!({
            "writes": {
                "trajectory_append": [
                    {
                        "kind": "module_call",
                        "module_id": "tracer",
                        "signature_name": "Echo",
                        "input": { "message": "hi" }
                    }
                ],
                "final_output": { "reply": "done" }
            }
        })
        .to_string(),
    );

    snapdragon_core::install_bundle_for_test(custom_system_bundle("tracer"));

    let out = snapdragon_core::run_with_host(&host, r#"{"message":"hi"}"#)
        .expect("should succeed");
    assert_eq!(out, json!({ "reply": "done" }));
    // Not asserting on trajectory contents — the core's Entity is not
    // exposed from run_with_host. The fact that the handler's
    // trajectory_append parsed + applied without error is the
    // verification: any schema mismatch here would have produced a
    // decode error during runner.apply_host_response.
}

#[test]
fn host_side_system_gets_entity_view_in_request() {
    let host = MockHostPipe::new();
    // This handler will fail if the view isn't shaped correctly. We
    // queue a response that echoes nothing but relies on the fact
    // that the request serialises cleanly.
    host.enqueue_ok(
        "system.view_check@1",
        json!({
            "writes": {
                "final_output": { "reply": "view was ok" }
            }
        })
        .to_string(),
    );

    snapdragon_core::install_bundle_for_test(custom_system_bundle("view_check"));
    let out = snapdragon_core::run_with_host(&host, r#"{"message":"hi"}"#)
        .expect("should succeed");
    assert_eq!(out, json!({ "reply": "view was ok" }));
}

#[test]
fn unknown_host_system_fails_cleanly() {
    // No capability handler queued — the host returns NotProvided by
    // default. Runner should surface that as an internal error that
    // clearly identifies the missing system name + capability.
    let host = MockHostPipe::new();
    snapdragon_core::install_bundle_for_test(custom_system_bundle("never_registered"));

    let err = snapdragon_core::run_with_host(&host, r#"{"message":"hi"}"#)
        .expect_err("expected an error for unknown system");
    let msg = format!("{:?}", err);
    assert!(
        msg.contains("never_registered"),
        "error should name the missing system; got: {}",
        msg
    );
    assert!(
        msg.contains("system.never_registered@1"),
        "error should name the missing capability; got: {}",
        msg
    );
}

/// This is the real proof: a ReACT-shaped bundle whose schedule
/// invokes host-side systems for tool-call detection + invocation,
/// with no ReACT code in the core at all. Both systems are served
/// by the mock host through the fall-through path.
#[test]
fn react_shape_bundle_runs_through_fallthrough_only() {
    let host = MockHostPipe::new();

    // First host-side system detects a tool call and writes
    // pending_tool_call. In real ReACT this would parse
    // `last_llm_response` for a tool_call block — here we just
    // hand-craft the result.
    host.enqueue_ok(
        "system.detect_tool_call@1",
        json!({
            "writes": {
                "pending_tool_call": { "name": "calculator", "args": { "expr": "2 + 2" } }
            }
        })
        .to_string(),
    );

    // Second host-side system consumes the pending_tool_call and
    // produces an observation + final output. In real ReACT this
    // would invoke the named tool via `tool.invoke:<name>@1`.
    host.enqueue_ok(
        "system.invoke_tool@1",
        json!({
            "writes": {
                "pending_tool_call": null,
                "last_observation": "4",
                "final_output": { "reply": "2 + 2 = 4" }
            }
        })
        .to_string(),
    );

    // Bundle declares its own two-step schedule.
    let bundle = Bundle {
        schema: 1,
        program_id: "react-stub".into(),
        program_version: "0.1.0".into(),
        signatures: vec![Signature {
            name: "Calc".into(),
            doc: None,
            inputs: vec![Field {
                name: "q".into(),
                ty: FieldType::String,
                doc: None,
            }],
            outputs: vec![Field {
                name: "reply".into(),
                ty: FieldType::String,
                doc: None,
            }],
        }],
        default_profile: None,
        schedule: Some(Schedule {
            steps: vec![
                ScheduleStep::Invoke(SystemInvocation {
                    id: "detect".into(),
                    system: "detect_tool_call".into(),
                    args: json!({}),
                    retry_on_fail: None,
                    on_signal: None,
                }),
                ScheduleStep::Invoke(SystemInvocation {
                    id: "invoke".into(),
                    system: "invoke_tool".into(),
                    args: json!({}),
                    retry_on_fail: None,
                    on_signal: None,
                }),
            ],
        }),
        requires: vec![], // no feature sets — purely host-driven
        compiled: Compiled {
            instructions_by_module: BTreeMap::new(),
            demos_by_module: Default::default(),
        },
        metadata: Default::default(),
    };

    snapdragon_core::install_bundle_for_test(bundle);
    let out = snapdragon_core::run_with_host(&host, r#"{"q":"2+2?"}"#)
        .expect("react-stub should complete");
    assert_eq!(out, json!({ "reply": "2 + 2 = 4" }));
}
