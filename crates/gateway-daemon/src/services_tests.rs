use std::collections::BTreeMap;

use snapdragon_gateway_core::{ServiceBudget, ServiceSpec, ServiceWorkerSpec};

use crate::GatewayDaemon;

#[tokio::test]
async fn daemon_tracks_service_runs_and_errors() {
    let daemon = GatewayDaemon::new();
    daemon
        .register_service(test_service("memory-worker", None))
        .await;
    daemon
        .record_service_run("memory-worker", 10, Some("ok".into()))
        .await;
    daemon.record_service_error("memory-worker", "boom").await;
    let status = daemon.status().await;
    assert_eq!(status.services[0].runs, 1);
    assert_eq!(status.services[0].errors, 1);
    assert_eq!(status.services[0].last_error.as_deref(), Some("boom"));
}

#[tokio::test]
async fn daemon_executes_service_worker_on_demand() {
    let daemon = GatewayDaemon::new();
    let worker = ServiceWorkerSpec {
        command: "sh".into(),
        args: vec![
            "-c".into(),
            r#"printf '{"summary":"indexed 2 sessions"}'"#.into(),
        ],
        cwd: None,
        env: BTreeMap::new(),
    };
    daemon
        .register_service(test_service("session-index", Some(worker)))
        .await;

    let status = daemon.run_service_now("session-index").await.unwrap();
    assert_eq!(status.runs, 1);
    assert_eq!(status.errors, 0);
    assert_eq!(status.last_summary.as_deref(), Some("indexed 2 sessions"));
}

fn test_service(name: &str, worker: Option<ServiceWorkerSpec>) -> ServiceSpec {
    ServiceSpec {
        name: name.into(),
        enabled: true,
        interval_ms: None,
        startup_delay_ms: None,
        restart: Default::default(),
        restart_intensity: Default::default(),
        backoff_ms: None,
        max_backoff_ms: None,
        budget: Some(ServiceBudget {
            max_fuel: None,
            timeout_ms: Some(1_000),
        }),
        worker,
    }
}
