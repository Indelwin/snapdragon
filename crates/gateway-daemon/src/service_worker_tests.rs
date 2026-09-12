use std::collections::BTreeMap;

use super::*;

fn worker(script: &str) -> ServiceWorkerSpec {
    ServiceWorkerSpec {
        command: "sh".into(),
        args: vec!["-c".into(), script.into()],
        cwd: None,
        env: BTreeMap::new(),
    }
}

#[tokio::test]
async fn service_worker_extracts_json_summary() {
    let daemon = GatewayDaemon::new();
    let summary = run_service_worker(
        &daemon,
        "svc",
        &worker(r#"printf '{"summary":"worker summary"}'"#),
        Some(1_000),
        Arc::new(ServiceRunControl::default()),
    )
    .await
    .unwrap();
    assert_eq!(summary.as_deref(), Some("worker summary"));
}

#[tokio::test]
async fn service_worker_drains_floods_with_bounded_preview() {
    let daemon = GatewayDaemon::new();
    let summary = run_service_worker(
        &daemon,
        "flood",
        &worker(
            "yes x | head -c 200000; printf '{\"summary\":\"done\"}' > \"$SNAPDRAGON_GATEWAY_COMPLETION_PATH\"",
        ),
        Some(2_000),
        Arc::new(ServiceRunControl::default()),
    )
    .await
    .unwrap();
    assert_eq!(summary.as_deref(), Some("done"));
    let [process] = daemon.worker_process_snapshot().await.try_into().unwrap();
    assert_eq!(process.stdout_preview.len(), PREVIEW_BYTES);
}

#[tokio::test]
async fn service_worker_kills_and_records_timeout() {
    let daemon = GatewayDaemon::new();
    let error = run_service_worker(
        &daemon,
        "svc",
        &worker("sleep 2"),
        Some(25),
        Arc::new(ServiceRunControl::default()),
    )
    .await
    .unwrap_err();
    assert!(error.contains("timed out"));
    let [process] = daemon.worker_process_snapshot().await.try_into().unwrap();
    assert_eq!(process.state, GatewayWorkerProcessState::TimedOut);
}

#[cfg(unix)]
#[tokio::test]
async fn service_worker_kills_descendants_that_hold_pipes_after_leader_exit() {
    let daemon = GatewayDaemon::new();
    let summary = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        run_service_worker(
            &daemon,
            "descendant",
            &worker("(sleep 60) & printf '%s' \"$!\""),
            None,
            Arc::new(ServiceRunControl::default()),
        ),
    )
    .await
    .expect("worker pipe drain should be bounded")
    .unwrap();
    let pid = summary.unwrap().parse::<i32>().unwrap();
    for _ in 0..100 {
        if unsafe { libc::kill(pid, 0) } != 0 {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("worker descendant {pid} survived process-group ownership cleanup");
}
