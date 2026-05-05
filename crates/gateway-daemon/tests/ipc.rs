use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use snapdragon_gateway_daemon::{GatewayDaemon, ipc::serve_unix_socket};
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

    let table = request(
        &path,
        json!({
            "id": 5,
            "method": "tables.create",
            "params": { "name": "state", "owner": "worker", "access": "Private" }
        }),
    )
    .await;
    assert_eq!(table["result"], true);

    let table = request(
        &path,
        json!({
            "id": 6,
            "method": "tables.show",
            "params": { "name": "state" }
        }),
    )
    .await;
    assert_eq!(table["result"]["owner"], "worker");
    server.abort();
    let _ = std::fs::remove_file(path);
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
