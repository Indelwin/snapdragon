use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use snapdragon_gateway_core::{
    GatewayAgentRuntimeCommand, GatewayAgentRuntimeDescriptor, GatewayAgentRuntimeKind,
    GatewayAgentRuntimeProtocol, GatewayEventRecord, GatewayEventState, GatewayJobSpec,
    GatewayJobState,
};
use snapdragon_gateway_daemon::GatewayStore;

#[test]
fn store_persists_jobs_events_logs_and_services() {
    let path = std::env::temp_dir().join(format!(
        "snapdragon-gateway-store-{}.sqlite",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let store = GatewayStore::open(&path).unwrap();
    let job = store
        .enqueue_job(
            "job_1".into(),
            GatewayJobSpec {
                kind: "agent.run".into(),
                queue: "default".into(),
                payload: serde_json::json!({"prompt":"test"}),
                priority: 0,
                max_attempts: 3,
                timeout_ms: Some(1_000),
            },
            10,
        )
        .unwrap();
    assert_eq!(job.state, GatewayJobState::Pending);
    assert_eq!(store.list_jobs().unwrap().len(), 1);
    let (running, _) = store
        .acquire_job("default", "worker-1", 1_000, 11)
        .unwrap()
        .unwrap();
    assert_eq!(running.state, GatewayJobState::Running);
    assert_eq!(store.active_leases(11).unwrap().len(), 1);
    assert_eq!(
        store.cancel_job("job_1", 12).unwrap().unwrap().state,
        GatewayJobState::Cancelled
    );
    assert!(store.active_leases(12).unwrap().is_empty());
    assert_eq!(
        store
            .complete_job("job_1", Some(serde_json::json!({"late": true})), 13)
            .unwrap()
            .unwrap()
            .state,
        GatewayJobState::Cancelled
    );
    assert_eq!(
        store
            .fail_job("job_1", "late failure".into(), 14)
            .unwrap()
            .unwrap()
            .state,
        GatewayJobState::Cancelled
    );

    let event = store
        .append_event(GatewayEventRecord {
            id: "event_1".into(),
            kind: "channel.run".into(),
            target: Some("local:test".into()),
            state: GatewayEventState::Pending,
            payload: Value::Null,
            created_at_ms: 15,
            updated_at_ms: 15,
        })
        .unwrap();
    assert_eq!(event.id, "event_1");
    assert_eq!(
        store.cancel_event("event_1", 16).unwrap().unwrap().state,
        GatewayEventState::Cancelled
    );
    let runtime = store
        .persist_agent_runtime(
            &GatewayAgentRuntimeDescriptor {
                id: "pi".into(),
                kind: GatewayAgentRuntimeKind::Pi,
                protocol: GatewayAgentRuntimeProtocol::Jsonl,
                label: Some("Pi Agent".into()),
                command: Some(GatewayAgentRuntimeCommand {
                    command: "pi".into(),
                    args: vec!["--mode".into(), "rpc".into()],
                    cwd: None,
                    env: Default::default(),
                }),
                supported_job_kinds: vec!["agent.run".into()],
                capabilities: vec!["skills.pi".into()],
                isolation: None,
                health: None,
                metadata: None,
            },
            17,
        )
        .unwrap();
    assert_eq!(runtime.id, "pi");
    assert_eq!(store.agent_runtime_snapshots().unwrap()[0].id, "pi");
    assert_eq!(
        store
            .append_log(18, "info", Some("job_1"), "runtime breadcrumb", None)
            .unwrap()
            .target
            .as_deref(),
        Some("job_1")
    );
    assert!(!store.tail_logs(None, 10).unwrap().is_empty());
    let _ = std::fs::remove_file(path);
}
