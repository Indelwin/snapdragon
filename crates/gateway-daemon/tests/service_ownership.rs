use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use snapdragon_gateway_core::{
    GatewayWorkerProcessState, ServiceBudget, ServiceSpec, ServiceWorkerSpec,
};
use snapdragon_gateway_daemon::GatewayDaemon;

#[tokio::test]
async fn scheduled_and_manual_service_runs_share_one_gate() {
    let root = temp_root("serial");
    std::fs::create_dir_all(&root).unwrap();
    let overlap = root.join("overlap");
    let runs = root.join("runs");
    let script = r#"
if ! mkdir "$RUN_ROOT/guard"; then
  printf 'overlap\n' >> "$RUN_ROOT/overlap"
  exit 9
fi
printf 'run\n' >> "$RUN_ROOT/runs"
sleep 0.05
rmdir "$RUN_ROOT/guard"
"#;
    let daemon = GatewayDaemon::new();
    daemon
        .register_service(service("serial", script, &root))
        .await;
    let first = {
        let daemon = daemon.clone();
        tokio::spawn(async move { daemon.run_service_now("serial").await })
    };
    let second = {
        let daemon = daemon.clone();
        tokio::spawn(async move { daemon.run_service_now("serial").await })
    };
    first.await.unwrap();
    second.await.unwrap();
    daemon.shutdown().await;

    assert!(!overlap.exists());
    assert_eq!(std::fs::read_to_string(runs).unwrap().lines().count(), 3);
    let processes = daemon.status().await.worker_processes;
    assert_eq!(processes.len(), 3);
    assert!(
        processes
            .iter()
            .all(|process| process.state == GatewayWorkerProcessState::Exited)
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn disable_cancels_and_joins_the_owned_process_group() {
    let root = temp_root("disable");
    std::fs::create_dir_all(&root).unwrap();
    let daemon = GatewayDaemon::new();
    daemon
        .register_service(service(
            "cancel",
            r#"sleep 60 & echo $! > "$RUN_ROOT/child.pid"; wait"#,
            &root,
        ))
        .await;
    let child = wait_for_pid(&root.join("child.pid")).await;
    tokio::time::timeout(
        Duration::from_secs(3),
        daemon.set_service_enabled("cancel", false),
    )
    .await
    .unwrap();
    wait_until_dead(child).await;
    assert_eq!(
        daemon.status().await.worker_processes[0].state,
        GatewayWorkerProcessState::Cancelled
    );
    assert!(!daemon.service_status("cancel").await.unwrap().enabled);
    daemon.shutdown().await;
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn shutdown_cancels_and_joins_the_owned_process_group() {
    let root = temp_root("shutdown");
    std::fs::create_dir_all(&root).unwrap();
    let daemon = GatewayDaemon::new();
    daemon
        .register_service(service(
            "cancel",
            r#"sleep 60 & echo $! > "$RUN_ROOT/child.pid"; wait"#,
            &root,
        ))
        .await;
    let child = wait_for_pid(&root.join("child.pid")).await;
    tokio::time::timeout(Duration::from_secs(3), daemon.shutdown())
        .await
        .unwrap();
    wait_until_dead(child).await;
    assert_eq!(
        daemon.status().await.worker_processes[0].state,
        GatewayWorkerProcessState::Cancelled
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn concurrent_replacements_leave_exactly_one_owned_service_loop() {
    let root = temp_root("replace");
    std::fs::create_dir_all(&root).unwrap();
    let daemon = GatewayDaemon::new();
    daemon
        .register_service(service(
            "replace",
            r#"sleep 60 & echo $! > "$RUN_ROOT/initial.pid"; wait"#,
            &root,
        ))
        .await;
    let initial = wait_for_pid(&root.join("initial.pid")).await;

    let barrier = Arc::new(tokio::sync::Barrier::new(3));
    let first = {
        let daemon = daemon.clone();
        let barrier = Arc::clone(&barrier);
        let spec = service(
            "replace",
            r#"sleep 60 & echo $! > "$RUN_ROOT/first.pid"; wait"#,
            &root,
        );
        tokio::spawn(async move {
            barrier.wait().await;
            daemon.register_service(spec).await;
        })
    };
    let second = {
        let daemon = daemon.clone();
        let barrier = Arc::clone(&barrier);
        let spec = service(
            "replace",
            r#"sleep 60 & echo $! > "$RUN_ROOT/second.pid"; wait"#,
            &root,
        );
        tokio::spawn(async move {
            barrier.wait().await;
            daemon.register_service(spec).await;
        })
    };
    barrier.wait().await;
    first.await.unwrap();
    second.await.unwrap();
    wait_until_dead(initial).await;
    wait_for_running_processes(&daemon, 1).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(running_processes(&daemon).await, 1);

    tokio::time::timeout(
        Duration::from_secs(3),
        daemon.set_service_enabled("replace", false),
    )
    .await
    .unwrap();
    assert_eq!(running_processes(&daemon).await, 0);
    assert!(daemon.status().await.service_tasks.is_empty());
    daemon.shutdown().await;
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn replacement_cancels_and_joins_an_inflight_manual_owner() {
    let root = temp_root("manual-replace");
    std::fs::create_dir_all(&root).unwrap();
    let daemon = GatewayDaemon::new();
    let mut initial = service(
        "manual-replace",
        r#"sleep 60 & echo $! > "$RUN_ROOT/manual.pid"; wait"#,
        &root,
    );
    initial.startup_delay_ms = Some(60_000);
    daemon.register_service(initial).await;
    let manual = {
        let daemon = daemon.clone();
        tokio::spawn(async move { daemon.run_service_now("manual-replace").await })
    };
    let child = wait_for_pid(&root.join("manual.pid")).await;
    let mut replacement = service("manual-replace", "printf replacement", &root);
    replacement.startup_delay_ms = Some(60_000);
    daemon.register_service(replacement).await;
    manual.await.unwrap();
    wait_until_dead(child).await;
    assert_eq!(running_processes(&daemon).await, 0);
    daemon.set_service_enabled("manual-replace", false).await;
    assert!(daemon.status().await.service_tasks.is_empty());
    daemon.shutdown().await;
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn shutdown_cancels_and_joins_an_inflight_manual_owner() {
    let root = temp_root("manual-shutdown");
    std::fs::create_dir_all(&root).unwrap();
    let daemon = GatewayDaemon::new();
    let mut spec = service(
        "manual-shutdown",
        r#"sleep 60 & echo $! > "$RUN_ROOT/manual.pid"; wait"#,
        &root,
    );
    spec.startup_delay_ms = Some(60_000);
    daemon.register_service(spec).await;
    let manual = {
        let daemon = daemon.clone();
        tokio::spawn(async move { daemon.run_service_now("manual-shutdown").await })
    };
    let child = wait_for_pid(&root.join("manual.pid")).await;
    tokio::time::timeout(Duration::from_secs(3), daemon.shutdown())
        .await
        .unwrap();
    manual.await.unwrap();
    wait_until_dead(child).await;
    assert_eq!(running_processes(&daemon).await, 0);
    assert!(daemon.status().await.service_tasks.is_empty());
    let _ = std::fs::remove_dir_all(root);
}

fn service(name: &str, script: &str, root: &Path) -> ServiceSpec {
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
            timeout_ms: None,
        }),
        worker: Some(ServiceWorkerSpec {
            command: "sh".into(),
            args: vec!["-c".into(), script.into()],
            cwd: None,
            env: BTreeMap::from([("RUN_ROOT".into(), root.display().to_string())]),
        }),
    }
}

async fn wait_for_pid(path: &Path) -> i32 {
    for _ in 0..100 {
        if let Ok(pid) = std::fs::read_to_string(path) {
            return pid.trim().parse().unwrap();
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("worker child pid was not written");
}

async fn wait_until_dead(pid: i32) {
    for _ in 0..100 {
        if !process_alive(pid) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("worker child process {pid} is still alive");
}

async fn wait_for_running_processes(daemon: &GatewayDaemon, expected: usize) {
    for _ in 0..100 {
        if running_processes(daemon).await >= expected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("service worker process did not start");
}

async fn running_processes(daemon: &GatewayDaemon) -> usize {
    daemon
        .status()
        .await
        .worker_processes
        .iter()
        .filter(|process| process.state == GatewayWorkerProcessState::Running)
        .count()
}

#[cfg(unix)]
fn process_alive(pid: i32) -> bool {
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn process_alive(_pid: i32) -> bool {
    false
}

fn temp_root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "snapdragon-gateway-service-{label}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}
