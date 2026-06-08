use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use snapdragon_gateway_core::{
    GatewayAgentRuntimeDescriptor, GatewayAgentRuntimeKind, GatewayAgentRuntimeProtocol,
    GatewayEventRecord, GatewayEventState, GatewayJobSpec, GatewayJobState,
    GatewayWorkerRegistration, GatewayWorkerState,
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
    let worker = store.worker("worker-1").unwrap().unwrap();
    assert_eq!(worker.state, GatewayWorkerState::Running);
    assert_eq!(worker.current_job_id.as_deref(), Some("job_1"));
    assert_eq!(store.active_leases(11).unwrap().len(), 1);
    assert_eq!(
        store.cancel_job("job_1", 12).unwrap().unwrap().state,
        GatewayJobState::Cancelled
    );
    assert_eq!(
        store.worker("worker-1").unwrap().unwrap().state,
        GatewayWorkerState::Idle
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

    let retried = store
        .enqueue_job(
            "job_retry".into(),
            GatewayJobSpec {
                kind: "agent.run".into(),
                queue: "default".into(),
                payload: serde_json::json!({"prompt":"retry"}),
                priority: 0,
                max_attempts: 2,
                timeout_ms: None,
            },
            15,
        )
        .unwrap();
    assert_eq!(retried.state, GatewayJobState::Pending);
    store.acquire_job("default", "worker-1", 1_000, 16).unwrap();
    assert_eq!(
        store
            .fail_job("job_retry", "try again".into(), 17)
            .unwrap()
            .unwrap()
            .state,
        GatewayJobState::Pending
    );
    store.acquire_job("default", "worker-1", 1_000, 18).unwrap();
    assert_eq!(
        store
            .fail_job("job_retry", "out of tries".into(), 19)
            .unwrap()
            .unwrap()
            .state,
        GatewayJobState::Failed
    );
    assert_eq!(
        store.retry_job("job_retry", 20).unwrap().unwrap().state,
        GatewayJobState::Pending
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
                command: None,
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
    let worker = store
        .register_worker(
            GatewayWorkerRegistration {
                id: "pi-worker".into(),
                queue: Some("default".into()),
                runtime_id: Some("pi".into()),
                service: Some("agent-jobs".into()),
                capabilities: vec!["agent.run".into()],
                status: Some("ready".into()),
                metadata: Some(serde_json::json!({"pid": 123})),
            },
            18,
        )
        .unwrap();
    assert_eq!(worker.runtime_id.as_deref(), Some("pi"));
    assert!(
        store
            .list_workers()
            .unwrap()
            .iter()
            .any(|worker| worker.id == "pi-worker")
    );
    assert_eq!(
        store
            .append_log(19, "info", Some("job_1"), "runtime breadcrumb", None)
            .unwrap()
            .target
            .as_deref(),
        Some("job_1")
    );
    assert!(!store.tail_logs(None, 10).unwrap().is_empty());
    let _ = std::fs::remove_file(path);
}
