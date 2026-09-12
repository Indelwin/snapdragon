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

#[cfg(unix)]
#[tokio::test]
async fn service_worker_kills_resistant_closed_pipe_descendant_without_touching_unrelated_process()
{
    let mut unrelated_command = tokio::process::Command::new("sleep");
    unrelated_command.arg("60").kill_on_drop(true);
    let mut unrelated = unrelated_command.spawn().unwrap();
    let unrelated_pid = unrelated.id().unwrap() as i32;
    let daemon = GatewayDaemon::new();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(4),
        run_service_worker(
            &daemon,
            "resistant-descendant",
            &worker(
                r#"
                leader=$$
                (trap '' TERM; exec </dev/null >/dev/null 2>/dev/null; while :; do sleep 60; done) &
                printf '{"summary":"%s:%s"}' "$leader" "$!" > "$SNAPDRAGON_GATEWAY_COMPLETION_PATH"
                exit 0
                "#,
            ),
            None,
            Arc::new(ServiceRunControl::default()),
        ),
    )
    .await;

    let unrelated_survived = unsafe { libc::kill(unrelated_pid, 0) } == 0;
    let _ = unrelated.kill().await;
    let _ = unrelated.wait().await;

    let summary = result
        .expect("worker process-group shutdown should be bounded")
        .unwrap()
        .unwrap();
    let (leader, descendant) = summary.split_once(':').unwrap();
    let leader = leader.parse::<i32>().unwrap();
    let descendant = descendant.parse::<i32>().unwrap();
    let descendant_survived = unsafe { libc::kill(descendant, 0) } == 0;
    if descendant_survived {
        unsafe {
            libc::kill(-leader, libc::SIGKILL);
        }
    }

    assert!(unrelated_survived, "unrelated process was killed");
    assert!(
        !descendant_survived,
        "SIGTERM-resistant worker descendant {descendant} survived cleanup"
    );
}
