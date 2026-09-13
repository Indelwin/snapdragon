use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use snapdragon_gateway_daemon::{
    GatewayDaemon, GatewayStore,
    ipc::{MAX_IPC_FRAME_BYTES, serve_unix_socket},
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

#[tokio::test]
async fn ipc_serves_status_and_service_registration() {
    let daemon = GatewayDaemon::new();
    let path = socket_path();
    let server = tokio::spawn(serve_unix_socket(daemon, path.clone()));
    wait_for_socket(&path).await;

    let response = request(
        &path,
        json!({
            "id": 1,
            "method": "services.register",
            "params": { "spec": { "name": "memory-worker", "enabled": true } }
        }),
    )
    .await;
    assert_eq!(response["ok"], true);

    let status = request(&path, json!({ "id": 2, "method": "status" })).await;
    assert_eq!(status["result"]["services"][0]["name"], "memory-worker");

    let capability = request(
        &path,
        json!({
            "id": 3,
            "method": "registry.register_capability",
            "params": { "capability": "memory.read", "actor": "worker" }
        }),
    )
    .await;
    assert_eq!(capability["ok"], true);

    let registry = request(&path, json!({ "id": 4, "method": "registry.list" })).await;
    assert_eq!(
        registry["result"]["capabilities"]["memory.read"][0],
        "worker"
    );

    let agent = request(
        &path,
        json!({
            "id": 5,
            "method": "agents.register",
            "params": {
                "descriptor": {
                    "id": "sd",
                    "kind": "sd",
                    "protocol": "embedded",
                    "supported_job_kinds": ["agent.run"],
                    "capabilities": ["tools.shell"]
                }
            }
        }),
    )
    .await;
    assert_eq!(agent["result"]["id"], "sd");

    let agents = request(&path, json!({ "id": 6, "method": "agents.list" })).await;
    assert_eq!(agents["result"][0]["protocol"], "embedded");

    let agent = request(
        &path,
        json!({
            "id": 7,
            "method": "agents.show",
            "params": { "id": "sd" }
        }),
    )
    .await;
    assert_eq!(agent["result"]["kind"], "sd");

    let table = request(
        &path,
        json!({
            "id": 8,
            "method": "tables.create",
            "params": { "name": "state", "owner": "worker", "access": "Private" }
        }),
    )
    .await;
    assert_eq!(table["result"], true);

    let table = request(
        &path,
        json!({
            "id": 9,
            "method": "tables.show",
            "params": { "name": "state" }
        }),
    )
    .await;
    assert_eq!(table["result"]["owner"], "worker");

    let status = request(&path, json!({ "id": 10, "method": "status" })).await;
    assert_eq!(status["result"]["agent_runtimes"][0]["id"], "sd");
    server.abort();
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn ipc_shutdown_cancels_and_joins_active_partial_frame_clients() {
    let daemon = GatewayDaemon::new();
    let path = socket_path();
    let server = tokio::spawn(serve_unix_socket(daemon.clone(), path.clone()));
    wait_for_socket(&path).await;
    let mut stream = UnixStream::connect(&path).await.unwrap();
    stream.write_all(b"{\"id\":1").await.unwrap();

    daemon.shutdown().await;
    tokio::time::timeout(std::time::Duration::from_secs(2), server)
        .await
        .expect("IPC server should join active clients on shutdown")
        .unwrap()
        .unwrap();
    assert!(!path.exists());
}

#[tokio::test]
async fn ipc_persists_jobs_events_and_logs() {
    let db = socket_path().with_extension("sqlite");
    let daemon = GatewayDaemon::with_store(GatewayStore::open(&db).unwrap())
        .await
        .unwrap();
    let path = socket_path();
    let server = tokio::spawn(serve_unix_socket(daemon, path.clone()));
    wait_for_socket(&path).await;

    let job = request(
        &path,
        json!({
            "id": 1,
            "method": "jobs.enqueue",
            "params": {
                "id": "job_1",
                "spec": {
                    "kind": "agent.run",
                    "queue": "default",
                    "payload": { "prompt": "test" },
                    "priority": 0,
                    "max_attempts": 1
                }
            }
        }),
    )
    .await;
    assert_eq!(job["result"]["state"], "Pending");

    let lease = request(
        &path,
        json!({
            "id": 2,
            "method": "jobs.acquire",
            "params": { "queue": "default", "worker": "worker", "lease_ms": 1000 }
        }),
    )
    .await;
    assert_eq!(lease["result"]["lease"]["worker"], "worker");
    let lease_id = lease["result"]["lease"]["id"].as_str().unwrap();
    let lease_attempt = lease["result"]["lease"]["attempt"].as_u64().unwrap();
    let worker = request(
        &path,
        json!({
            "id": 20,
            "method": "workers.show",
            "params": { "id": "worker" }
        }),
    )
    .await;
    assert_eq!(worker["result"]["current_job_id"], "job_1");
    assert_eq!(worker["result"]["state"], "running");

    let completed = request(
        &path,
        json!({
            "id": 3,
            "method": "jobs.complete",
            "params": {
                "id": "job_1",
                "lease_id": lease_id,
                "attempt": lease_attempt,
                "result": { "ok": true }
            }
        }),
    )
    .await;
    assert_eq!(completed["result"]["state"], "Completed");
    let worker = request(
        &path,
        json!({
            "id": 21,
            "method": "workers.heartbeat",
            "params": {
                "heartbeat": {
                    "id": "worker",
                    "state": "idle",
                    "status": "waiting"
                }
            }
        }),
    )
    .await;
    assert_eq!(worker["result"]["status"], "waiting");
    let workers = request(&path, json!({ "id": 22, "method": "workers.list" })).await;
    assert_eq!(workers["result"]["items"][0]["id"], "worker");

    request(
        &path,
        json!({
            "id": 23,
            "method": "jobs.enqueue",
            "params": {
                "id": "job_retry",
                "spec": {
                    "kind": "agent.run",
                    "queue": "default",
                    "payload": { "prompt": "retry" },
                    "priority": 0,
                    "max_attempts": 1
                }
            }
        }),
    )
    .await;
    let retry_lease = request(
        &path,
        json!({
            "id": 24,
            "method": "jobs.acquire",
            "params": { "queue": "default", "worker": "worker", "lease_ms": 1000 }
        }),
    )
    .await;
    let failed = request(
        &path,
        json!({
            "id": 25,
            "method": "jobs.fail",
            "params": {
                "id": "job_retry",
                "lease_id": retry_lease["result"]["lease"]["id"],
                "attempt": retry_lease["result"]["lease"]["attempt"],
                "error": "needs another try"
            }
        }),
    )
    .await;
    assert_eq!(failed["result"]["state"], "Failed");
    let retry = request(
        &path,
        json!({
            "id": 26,
            "method": "jobs.retry",
            "params": { "id": "job_retry" }
        }),
    )
    .await;
    assert_eq!(retry["result"]["state"], "Pending");

    let sandbox = request(
        &path,
        json!({
            "id": 27,
            "method": "sandboxes.register",
            "params": {
                "lease": {
                    "id": "lease_test",
                    "sandbox_id": "sandbox_test",
                    "cwd": "/tmp/sandbox",
                    "acquired_at_ms": 30,
                    "expires_at_ms": 40,
                    "backend": "worktree",
                    "project": { "id": "project_test", "root": "/tmp/project", "branch": "main" },
                    "reference_roots": ["/tmp/reference"]
                }
            }
        }),
    )
    .await;
    assert_eq!(sandbox["result"]["id"], "lease_test");
    let sandboxes = request(&path, json!({ "id": 28, "method": "sandboxes.list" })).await;
    assert_eq!(
        sandboxes["result"]["items"][0]["sandbox_id"],
        "sandbox_test"
    );
    let sandbox = request(
        &path,
        json!({
            "id": 29,
            "method": "sandboxes.show",
            "params": { "id": "lease_test" }
        }),
    )
    .await;
    assert_eq!(sandbox["result"]["cwd"], "/tmp/sandbox");
    let sandbox = request(
        &path,
        json!({
            "id": 30,
            "method": "sandboxes.release",
            "params": { "id": "lease_test" }
        }),
    )
    .await;
    assert_eq!(sandbox["result"]["id"], "lease_test");

    let event = request(
        &path,
        json!({
            "id": 4,
            "method": "events.append",
            "params": { "id": "event_1", "kind": "channel.run", "payload": {} }
        }),
    )
    .await;
    assert_eq!(event["result"]["state"], "Pending");

    let logs = request(
        &path,
        json!({
            "id": 5,
            "method": "logs.append",
            "params": {
                "at_ms": 20,
                "level": "info",
                "target": "job_1",
                "message": "runtime breadcrumb",
                "data": { "runtimeId": "pi" }
            }
        }),
    )
    .await;
    assert_eq!(logs["result"]["message"], "runtime breadcrumb");

    let logs = request(
        &path,
        json!({ "id": 6, "method": "logs.tail", "params": { "target": "job_1" } }),
    )
    .await;
    assert!(logs["result"].as_array().unwrap().len() >= 2);
    server.abort();
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(db);
}

#[tokio::test]
async fn oversized_ipc_frame_is_rejected_without_poisoning_the_connection() {
    let daemon = GatewayDaemon::new();
    let path = socket_path();
    let server = tokio::spawn(serve_unix_socket(daemon.clone(), path.clone()));
    wait_for_socket(&path).await;
    let mut stream = UnixStream::connect(&path).await.unwrap();
    stream
        .write_all(&vec![b'x'; MAX_IPC_FRAME_BYTES + 1])
        .await
        .unwrap();
    stream
        .write_all(b"\n{\"id\":2,\"method\":\"status\"}\n")
        .await
        .unwrap();
    let mut lines = BufReader::new(stream).lines();
    let oversized: Value =
        serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(oversized["ok"], false);
    assert!(oversized["error"].as_str().unwrap().contains("exceeds"));
    let status: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
    assert_eq!(status["id"], 2);
    assert_eq!(status["ok"], true);
    daemon.shutdown().await;
    server.await.unwrap().unwrap();
}

#[tokio::test]
async fn live_socket_ownership_cannot_be_stolen_and_shutdown_cleans_it() {
    let owner = GatewayDaemon::new();
    let path = socket_path();
    let lock = std::path::PathBuf::from(format!("{}.lock", path.display()));
    let server = tokio::spawn(serve_unix_socket(owner.clone(), path.clone()));
    wait_for_socket(&path).await;
    let error = serve_unix_socket(GatewayDaemon::new(), path.clone())
        .await
        .unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::AddrInUse);
    assert!(path.exists());
    owner.shutdown().await;
    server.await.unwrap().unwrap();
    assert!(!path.exists());
    assert!(lock.exists());
    let replacement = GatewayDaemon::new();
    let replacement_server = tokio::spawn(serve_unix_socket(replacement.clone(), path.clone()));
    wait_for_socket(&path).await;
    replacement.shutdown().await;
    replacement_server.await.unwrap().unwrap();
    let _ = std::fs::remove_file(lock);
}

fn socket_path() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "snapdragon-gateway-{}.sock",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

async fn request(path: &Path, value: Value) -> Value {
    let mut stream = UnixStream::connect(path).await.unwrap();
    stream
        .write_all(format!("{value}\n").as_bytes())
        .await
        .unwrap();
    let mut lines = BufReader::new(stream).lines();
    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap()
}

async fn wait_for_socket(path: &Path) {
    for _ in 0..20 {
        if path.exists() {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("socket was not created");
}
