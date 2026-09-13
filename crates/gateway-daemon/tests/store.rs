use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, params};
use serde_json::{Value, json};
use snapdragon_gateway_core::{
    GatewayAgentRuntimeDescriptor, GatewayAgentRuntimeKind, GatewayAgentRuntimeProtocol,
    GatewayEventRecord, GatewayEventState, GatewayJobSpec, GatewayJobState, GatewayProjectRef,
    GatewaySandboxBackend, GatewaySandboxLease, GatewayWorkerRegistration, GatewayWorkerState,
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
    let (running, first_lease) = store
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
    assert!(
        store
            .complete_job(
                "job_1",
                &first_lease.id,
                first_lease.attempt,
                Some(serde_json::json!({"late": true})),
                13,
            )
            .unwrap_err()
            .contains("stale lease fence")
    );
    assert!(
        store
            .fail_job(
                "job_1",
                &first_lease.id,
                first_lease.attempt,
                "late failure".into(),
                14,
            )
            .unwrap_err()
            .contains("stale lease fence")
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
    let (_, retry_lease) = store
        .acquire_job("default", "worker-1", 1_000, 16)
        .unwrap()
        .unwrap();
    assert_eq!(
        store
            .fail_job(
                "job_retry",
                &retry_lease.id,
                retry_lease.attempt,
                "try again".into(),
                17,
            )
            .unwrap()
            .unwrap()
            .state,
        GatewayJobState::Pending
    );
    let (_, final_lease) = store
        .acquire_job("default", "worker-1", 1_000, 18)
        .unwrap()
        .unwrap();
    assert_eq!(
        store
            .fail_job(
                "job_retry",
                &final_lease.id,
                final_lease.attempt,
                "out of tries".into(),
                19,
            )
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
    let sandbox = store
        .register_sandbox_lease(
            GatewaySandboxLease {
                id: "lease_test".into(),
                sandbox_id: "sandbox_test".into(),
                cwd: "/tmp/sandbox".into(),
                acquired_at_ms: 19,
                expires_at_ms: Some(25),
                backend: Some(GatewaySandboxBackend::Worktree),
                project: Some(GatewayProjectRef {
                    id: "project_test".into(),
                    root: "/tmp/project".into(),
                    branch: Some("main".into()),
                }),
                reference_roots: vec!["/tmp/reference".into()],
            },
            19,
        )
        .unwrap();
    assert_eq!(sandbox.id, "lease_test");
    assert_eq!(
        store
            .sandbox_lease("lease_test")
            .unwrap()
            .unwrap()
            .sandbox_id,
        "sandbox_test"
    );
    assert_eq!(store.list_sandbox_leases().unwrap().len(), 1);
    assert_eq!(store.expire_sandbox_leases(24).unwrap(), 0);
    assert_eq!(store.expire_sandbox_leases(25).unwrap(), 1);
    assert!(store.list_sandbox_leases().unwrap().is_empty());
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

#[test]
fn store_migrates_active_pre_fence_leases() {
    let path = std::env::temp_dir().join(format!(
        "snapdragon-gateway-legacy-lease-{}.sqlite",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "create table gateway_jobs(
               id text primary key,
               kind text not null,
               queue text not null,
               state text not null,
               priority integer not null default 0,
               status_json text not null,
               updated_at_ms integer not null
             );
             create table gateway_leases(
               id text primary key,
               job_id text not null,
               worker text not null,
               acquired_at_ms integer not null,
               expires_at_ms integer not null
             );",
        )
        .unwrap();
    let status = json!({
        "id": "legacy-job",
        "spec": {
            "kind": "agent.run",
            "queue": "default",
            "payload": {},
            "priority": 0,
            "max_attempts": 3,
            "timeout_ms": null
        },
        "state": "Running",
        "attempts": 2,
        "created_at_ms": 1,
        "updated_at_ms": 2,
        "lease_id": "legacy-lease",
        "lease_expires_at_ms": 1_000,
        "last_error": null,
        "result": null
    });
    connection
        .execute(
            "insert into gateway_jobs values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                "legacy-job",
                "agent.run",
                "default",
                "running",
                0,
                status.to_string(),
                2
            ],
        )
        .unwrap();
    connection
        .execute(
            "insert into gateway_leases values (?1, ?2, ?3, ?4, ?5)",
            params!["legacy-lease", "legacy-job", "legacy-worker", 2, 1_000],
        )
        .unwrap();
    drop(connection);

    let store = GatewayStore::open(&path).unwrap();
    let migrated = store.job("legacy-job").unwrap().unwrap();
    assert_eq!(migrated.lease_attempt, Some(2));
    let lease = store.active_leases(10).unwrap().pop().unwrap();
    assert_eq!(lease.attempt, 2);
    assert_eq!(
        store
            .complete_job("legacy-job", "legacy-lease", 2, None, 10)
            .unwrap()
            .unwrap()
            .state,
        GatewayJobState::Completed
    );
    drop(store);
    let _ = std::fs::remove_file(path);
}
