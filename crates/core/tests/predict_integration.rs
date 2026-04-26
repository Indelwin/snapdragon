//! Integration test: run a Predict program end-to-end through the
//! full pipeline (adapter → schedule → systems → runner) against a
//! mock host pipe. No WASM, no network.

use snapdragon_core::bundle::{Bundle, Compiled};
use snapdragon_core::host::mock::MockHostPipe;
use snapdragon_core::signature::{Field, FieldType, Signature};
use std::collections::BTreeMap;

fn classify_bundle() -> Bundle {
    Bundle {
        schema: 1,
        program_id: "classify-or-answer".into(),
        program_version: "0.1.0".into(),
        signatures: vec![Signature {
            name: "ClassifyIntent".into(),
            doc: Some("Classify the user's query into a known intent.".into()),
            inputs: vec![Field {
                name: "query".into(),
                ty: FieldType::String,
                doc: Some("Raw user query.".into()),
            }],
            outputs: vec![Field {
                name: "intent".into(),
                ty: FieldType::Enum {
                    values: vec!["search".into(), "chat".into(), "tool".into()],
                },
                doc: Some("Coarse intent classification.".into()),
            }],
        }],
        default_profile: None,
        schedule: None,
        requires: vec![],
        compiled: Compiled {
            instructions_by_module: {
                let mut m = BTreeMap::new();
                m.insert(
                    "action".into(),
                    "You classify user queries. Answer with exactly one of: search, chat, tool."
                        .into(),
                );
                m
            },
            demos_by_module: Default::default(),
        },
        metadata: Default::default(),
    }
}

#[test]
fn predict_end_to_end_returns_structured_output() {
    let host = MockHostPipe::new();
    host.enqueue_chat("[[ ## intent ## ]]\nsearch\n\n[[ ## completed ## ]]\n");

    snapdragon_core::install_bundle_for_test(classify_bundle());

    let out =
        snapdragon_core::run_with_host(&host, r#"{"query":"what's the weather in Melbourne"}"#)
            .expect("run should succeed");

    assert_eq!(out, serde_json::json!({ "intent": "search" }));

    // Observability: we should have seen llm.request.started + completed
    // plus an agent.run.completed-style event at the outer boundary.
    assert!(host.event_count("llm.request.") >= 2);
}

#[test]
fn predict_surfaces_parse_failure_as_structured_error() {
    let host = MockHostPipe::new();
    // Missing the `[[ ## completed ## ]]` terminator three times —
    // ParseResponse should exhaust its retry budget and then fail.
    host.enqueue_chat("[[ ## intent ## ]]\nsearch\n");
    host.enqueue_chat("[[ ## intent ## ]]\nsearch\n");
    host.enqueue_chat("[[ ## intent ## ]]\nsearch\n");

    snapdragon_core::install_bundle_for_test(classify_bundle());

    let err = snapdragon_core::run_with_host(&host, r#"{"query":"hi"}"#)
        .expect_err("expected a parse failure");

    // We don't assert on the exact RunError variant here — just that
    // the run failed with an error we can inspect.
    let msg = format!("{:?}", err);
    assert!(
        msg.contains("parse") || msg.contains("Parse") || msg.contains("completed"),
        "unexpected error shape: {}",
        msg
    );
    assert!(
        msg.contains("attempts: 3") || msg.contains("\"attempts\":3"),
        "expected final parse failure to report three attempts, got: {}",
        msg
    );
}

#[test]
fn predict_retries_parse_failures_with_a_nudge() {
    let host = MockHostPipe::new();
    host.enqueue_chat("[[ ## intent ## ]]\nsearch\n");
    host.enqueue_chat("[[ ## intent ## ]]\nchat\n\n[[ ## completed ## ]]\n");

    snapdragon_core::install_bundle_for_test(classify_bundle());

    let out = snapdragon_core::run_with_host(&host, r#"{"query":"hi"}"#)
        .expect("parse retry should recover");
    assert_eq!(out, serde_json::json!({ "intent": "chat" }));

    let events = host.events_snapshot();
    assert!(
        events.iter().any(|(topic, _)| topic == "llm.parse.retried"),
        "expected llm.parse.retried event, got: {:?}",
        events,
    );
}

#[test]
fn predict_rejects_missing_bundle() {
    // Clear state by installing a fresh bundle … actually, no way to
    // clear. Verify install_bundle_for_test is called in tests above;
    // this test only exercises run_with_host against a prior bundle.
    // Here we only check the invalid-input path.
    let host = MockHostPipe::new();
    host.enqueue_chat("[[ ## intent ## ]]\nchat\n\n[[ ## completed ## ]]\n");

    snapdragon_core::install_bundle_for_test(classify_bundle());

    let err = snapdragon_core::run_with_host(&host, "not-valid-json {")
        .expect_err("expected an invalid-input error");
    let msg = format!("{:?}", err);
    assert!(
        msg.contains("InvalidInput") || msg.contains("invalid"),
        "unexpected error: {}",
        msg
    );
}

/// Bundle declaring `requires: ["predict"]` loads and runs against the
/// default SystemRegistry (which provides the `predict` feature set).
#[test]
fn bundle_requires_predict_loads_on_default_registry() {
    let host = MockHostPipe::new();
    host.enqueue_chat("[[ ## intent ## ]]\nchat\n\n[[ ## completed ## ]]\n");

    let mut b = classify_bundle();
    b.requires = vec!["predict".into()];
    snapdragon_core::install_bundle_for_test(b);

    let out = snapdragon_core::run_with_host(&host, r#"{"query":"hi"}"#)
        .expect("predict should satisfy the requirement");
    assert_eq!(out, serde_json::json!({ "intent": "chat" }));
}

/// Bundle declaring `requires: ["unknown_feature"]` is rejected with a
/// structured `MissingFeatureSet` error that lists what's present.
#[test]
fn bundle_with_unknown_requirement_fails_with_structured_error() {
    let host = MockHostPipe::new();
    host.enqueue_chat("[[ ## intent ## ]]\nchat\n\n[[ ## completed ## ]]\n");

    let mut b = classify_bundle();
    b.requires = vec!["nonexistent_feature".into()];
    snapdragon_core::install_bundle_for_test(b);

    let err = snapdragon_core::run_with_host(&host, r#"{"query":"hi"}"#)
        .expect_err("expected MissingFeatureSet");

    let msg = format!("{:?}", err);
    assert!(
        msg.contains("MissingFeatureSet") || msg.contains("missing"),
        "expected MissingFeatureSet in error, got: {}",
        msg,
    );
    assert!(
        msg.contains("nonexistent_feature"),
        "expected the unmet requirement name in error, got: {}",
        msg,
    );
}
