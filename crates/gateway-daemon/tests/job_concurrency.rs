use std::{
    sync::{Arc, Barrier},
    time::{SystemTime, UNIX_EPOCH},
};

use snapdragon_gateway_core::{
    GatewayJobSpec, GatewayJobState, GatewayWorkerHeartbeat, GatewayWorkerRegistration,
    GatewayWorkerState,
};
use snapdragon_gateway_daemon::{GatewayDaemon, GatewayStore};

#[test]
fn concurrent_claims_have_one_winner() {
    let path = test_store_path("claims");
    let store = GatewayStore::open(&path).unwrap();
    enqueue(&store, "job", 4, 1);
    let barrier = Arc::new(Barrier::new(9));
    let handles = (0..8)
        .map(|index| {
            let store = GatewayStore::open(&path).unwrap();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                store.acquire_job("default", &format!("worker-{index}"), 1_000, 2)
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();
    let winners = handles
        .into_iter()
        .map(|handle| usize::from(handle.join().unwrap().unwrap().is_some()))
        .sum::<usize>();
    assert_eq!(winners, 1);
    assert_consistent(&store, "job");
}

#[test]
fn cancel_and_retry_are_atomic_with_claims() {
    for index in 0..32 {
        let path = test_store_path(&format!("cancel-{index}"));
        let store = GatewayStore::open(&path).unwrap();
        enqueue(&store, "job", 2, 1);
        let barrier = Arc::new(Barrier::new(3));
        let claim = {
            let store = GatewayStore::open(&path).unwrap();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                store.acquire_job("default", "worker", 1_000, 2).unwrap()
            })
        };
        let cancel = {
            let store = GatewayStore::open(&path).unwrap();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                store.cancel_job("job", 3).unwrap()
            })
        };
        barrier.wait();
        let _ = claim.join().unwrap();
        assert_eq!(
            cancel.join().unwrap().unwrap().state,
            GatewayJobState::Cancelled
        );
        assert_consistent(&store, "job");
        assert!(store.active_leases(3).unwrap().is_empty());

        enqueue(&store, "retry", 1, 4);
        let (_, lease) = store
            .acquire_job("default", "worker", 1_000, 5)
            .unwrap()
            .unwrap();
        store
            .fail_job("retry", &lease.id, lease.attempt, "failed".into(), 6)
            .unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let retry = {
            let store = GatewayStore::open(&path).unwrap();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                store.retry_job("retry", 7).unwrap()
            })
        };
        let claim = {
            let store = GatewayStore::open(&path).unwrap();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                store.acquire_job("default", "worker", 1_000, 8).unwrap()
            })
        };
        barrier.wait();
        let _ = retry.join().unwrap();
        let _ = claim.join().unwrap();
        assert_consistent(&store, "retry");
    }
}

#[test]
fn stale_attempt_cannot_renew_or_finish_a_new_lease() {
    let store = test_store("fence");
    enqueue(&store, "job", 2, 1);
    let (_, first) = store
        .acquire_job("default", "worker", 10, 2)
        .unwrap()
        .unwrap();
    assert_eq!(store.expire_leases(12).unwrap(), 1);
    let (_, second) = store
        .acquire_job("default", "worker", 100, 13)
        .unwrap()
        .unwrap();
    assert_ne!(first.id, second.id);
    assert_eq!(second.attempt, first.attempt + 1);

    assert!(
        store
            .renew_job("job", &first.id, first.attempt, 100, 14)
            .unwrap_err()
            .contains("stale lease fence")
    );
    assert!(
        store
            .complete_job("job", &first.id, first.attempt, None, 14)
            .unwrap_err()
            .contains("stale lease fence")
    );
    assert!(
        store
            .fail_job("job", &first.id, first.attempt, "late".into(), 14)
            .unwrap_err()
            .contains("stale lease fence")
    );
    let active = store.active_leases(14).unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, second.id);
    assert_eq!(
        store
            .complete_job("job", &second.id, second.attempt, None, 15)
            .unwrap()
            .unwrap()
            .state,
        GatewayJobState::Completed
    );
}

#[test]
fn duplicate_ids_and_double_worker_leases_are_rejected_without_clobbering_state() {
    let store = test_store("identity-worker");
    enqueue(&store, "first", 2, 1);
    assert!(
        store
            .enqueue_job("first".into(), agent_run_spec(2), 2)
            .unwrap_err()
            .contains("already exists")
    );
    enqueue(&store, "second", 2, 3);
    let (_, lease) = store
        .acquire_job("default", "one-worker", 1_000, 4)
        .unwrap()
        .unwrap();
    assert!(
        store
            .acquire_job("default", "one-worker", 1_000, 5)
            .unwrap_err()
            .contains("is busy")
    );
    assert_eq!(
        store.job("second").unwrap().unwrap().state,
        GatewayJobState::Pending
    );
    assert_eq!(
        store
            .worker("one-worker")
            .unwrap()
            .unwrap()
            .current_lease_id
            .as_deref(),
        Some(lease.id.as_str())
    );
    store
        .complete_job("first", &lease.id, lease.attempt, None, 6)
        .unwrap();
    assert_eq!(
        store
            .acquire_job("default", "one-worker", 1_000, 7)
            .unwrap()
            .unwrap()
            .0
            .id,
        "second"
    );
}

#[test]
fn registration_and_idle_heartbeat_cannot_reset_a_leased_worker() {
    let store = test_store("worker-registration");
    enqueue(&store, "job", 1, 1);
    let (_, lease) = store
        .acquire_job("default", "leased-worker", 1_000, 2)
        .unwrap()
        .unwrap();
    let registered = store
        .register_worker(
            GatewayWorkerRegistration {
                id: "leased-worker".into(),
                queue: Some("default".into()),
                runtime_id: Some("sd".into()),
                service: Some("agent-jobs".into()),
                capabilities: vec!["agent.run".into()],
                status: Some("registered again".into()),
                metadata: None,
            },
            3,
        )
        .unwrap();
    assert_eq!(registered.state, GatewayWorkerState::Running);
    assert_eq!(
        registered.current_lease_id.as_deref(),
        Some(lease.id.as_str())
    );
    let heartbeat = store
        .heartbeat_worker(
            GatewayWorkerHeartbeat {
                id: "leased-worker".into(),
                state: Some(GatewayWorkerState::Idle),
                queue: None,
                status: Some("incorrectly idle".into()),
                last_error: None,
                metadata: None,
            },
            4,
        )
        .unwrap()
        .unwrap();
    assert_eq!(heartbeat.state, GatewayWorkerState::Running);
    assert_eq!(heartbeat.current_job_id.as_deref(), Some("job"));
}

#[tokio::test]
async fn daemon_watchdog_expires_leases_without_status_reads() {
    let store = test_store("watchdog");
    let daemon = GatewayDaemon::with_store(store.clone()).await.unwrap();
    let now = epoch_ms();
    enqueue(&store, "job", 2, now);
    store
        .acquire_job("default", "worker", 20, now)
        .unwrap()
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    assert_eq!(
        store.job("job").unwrap().unwrap().state,
        GatewayJobState::Pending
    );
    daemon.shutdown().await;
}

fn enqueue(store: &GatewayStore, id: &str, max_attempts: u32, now_ms: u64) {
    store
        .enqueue_job(id.into(), agent_run_spec(max_attempts), now_ms)
        .unwrap();
}

fn agent_run_spec(max_attempts: u32) -> GatewayJobSpec {
    GatewayJobSpec {
        kind: "agent.run".into(),
        queue: "default".into(),
        payload: serde_json::json!({}),
        priority: 0,
        max_attempts,
        timeout_ms: None,
    }
}

fn assert_consistent(store: &GatewayStore, id: &str) {
    let job = store.job(id).unwrap().unwrap();
    let leases = store
        .active_leases(0)
        .unwrap()
        .into_iter()
        .filter(|lease| lease.job_id == id)
        .collect::<Vec<_>>();
    if job.state == GatewayJobState::Running {
        assert_eq!(leases.len(), 1);
        assert_eq!(job.lease_id.as_deref(), Some(leases[0].id.as_str()));
        assert_eq!(job.lease_attempt, Some(leases[0].attempt));
    } else {
        assert!(leases.is_empty());
        assert!(job.lease_id.is_none());
        assert!(job.lease_attempt.is_none());
    }
}

fn test_store(label: &str) -> GatewayStore {
    GatewayStore::open(test_store_path(label)).unwrap()
}

fn test_store_path(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "snapdragon-gateway-{label}-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
