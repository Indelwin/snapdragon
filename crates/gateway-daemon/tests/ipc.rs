use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use snapdragon_gateway_daemon::{GatewayDaemon, GatewayStore, ipc::serve_unix_socket};
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

    let completed = request(
        &path,
        json!({
            "id": 3,
            "method": "jobs.complete",
            "params": { "id": "job_1", "result": { "ok": true } }
        }),
    )
    .await;
    assert_eq!(completed["result"]["state"], "Completed");

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
        json!({ "id": 5, "method": "logs.tail", "params": {} }),
    )
    .await;
    assert!(logs["result"].as_array().unwrap().len() >= 2);
    server.abort();
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(db);
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
