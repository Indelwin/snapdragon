use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use snapdragon_gateway_core::{GatewayJobSpec, GatewayJobState};
use snapdragon_gateway_daemon::GatewayStore;

#[test]
fn expired_leases_requeue_jobs_until_attempts_are_exhausted() {
    let path = temp_store_path();
    let _ = std::fs::remove_file(&path);
    let store = GatewayStore::open(&path).unwrap();

    store
        .enqueue_job("job_retry".into(), agent_run_spec(2), 10)
        .unwrap();
    let (running, lease) = store
        .acquire_job("default", "worker-1", 5, 20)
        .unwrap()
        .unwrap();
    assert_eq!(running.state, GatewayJobState::Running);
    assert_eq!(running.attempts, 1);
    assert_eq!(lease.expires_at_ms, 25);
    assert_eq!(queue_depth(&store, "default"), (0, 1));
    assert_eq!(store.active_leases(24).unwrap().len(), 1);

    assert_eq!(store.expire_leases(24).unwrap(), 0);
    assert_eq!(
        store.job("job_retry").unwrap().unwrap().state,
        GatewayJobState::Running
    );

    assert_eq!(store.expire_leases(25).unwrap(), 1);
    let retry = store.job("job_retry").unwrap().unwrap();
    assert_eq!(retry.state, GatewayJobState::Pending);
    assert_eq!(retry.attempts, 1);
    assert_eq!(retry.last_error.as_deref(), Some("lease expired"));
    assert!(retry.lease_id.is_none());
    assert!(retry.lease_expires_at_ms.is_none());
    assert!(store.active_leases(25).unwrap().is_empty());
    assert_eq!(queue_depth(&store, "default"), (1, 0));

    let (running_again, _) = store
        .acquire_job("default", "worker-2", 5, 30)
        .unwrap()
        .unwrap();
    assert_eq!(running_again.state, GatewayJobState::Running);
    assert_eq!(running_again.attempts, 2);
    assert_eq!(queue_depth(&store, "default"), (0, 1));

    assert_eq!(store.expire_leases(35).unwrap(), 1);
    let failed = store.job("job_retry").unwrap().unwrap();
    assert_eq!(failed.state, GatewayJobState::Failed);
    assert_eq!(failed.attempts, 2);
    assert_eq!(failed.last_error.as_deref(), Some("lease expired"));
    assert!(failed.lease_id.is_none());
    assert!(failed.lease_expires_at_ms.is_none());
    assert!(store.active_leases(35).unwrap().is_empty());
    assert_eq!(queue_depth(&store, "default"), (0, 0));

    let expiry_warnings = store
        .recent_failures(10)
        .unwrap()
        .into_iter()
        .filter(|log| {
            log.target.as_deref() == Some("job_retry") && log.message == "job lease expired"
        })
        .count();
    assert_eq!(expiry_warnings, 2);

    let _ = std::fs::remove_file(path);
}

fn agent_run_spec(max_attempts: u32) -> GatewayJobSpec {
    GatewayJobSpec {
        kind: "agent.run".into(),
        queue: "default".into(),
        payload: serde_json::json!({ "prompt": "lease test" }),
        priority: 0,
        max_attempts,
        timeout_ms: Some(1_000),
    }
}

fn queue_depth(store: &GatewayStore, queue: &str) -> (u64, u64) {
    store
        .queue_depths()
        .unwrap()
        .into_iter()
        .find(|depth| depth.queue == queue)
        .map(|depth| (depth.pending, depth.running))
        .unwrap_or((0, 0))
}

fn temp_store_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "snapdragon-gateway-lease-expiry-{}.sqlite",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}
