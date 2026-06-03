use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::{
    GatewayDaemon,
    ipc_core::{
        dispatch_agents, dispatch_envelopes, dispatch_registry, dispatch_services, dispatch_tables,
    },
    ipc_durable::{
        dispatch_events, dispatch_jobs, dispatch_logs, dispatch_sandboxes, dispatch_workers,
    },
};

#[derive(Debug, Deserialize)]
struct IpcRequest {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct IpcResponse {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub async fn serve_unix_socket(daemon: GatewayDaemon, path: impl AsRef<Path>) -> io::Result<()> {
    let path = path.as_ref();
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;
    loop {
        let (stream, _) = listener.accept().await?;
        let daemon = daemon.clone();
        tokio::spawn(async move {
            let _ = handle_client(daemon, stream).await;
        });
    }
}

async fn handle_client(daemon: GatewayDaemon, stream: UnixStream) -> io::Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        let response = handle_line(&daemon, &line).await;
        writer
            .write_all(serde_json::to_string(&response)?.as_bytes())
            .await?;
        writer.write_all(b"\n").await?;
    }
    Ok(())
}

async fn handle_line(daemon: &GatewayDaemon, line: &str) -> IpcResponse {
    match serde_json::from_str::<IpcRequest>(line) {
        Ok(request) => handle_request(daemon, request).await,
        Err(error) => IpcResponse {
            id: 0,
            ok: false,
            result: None,
            error: Some(error.to_string()),
        },
    }
}

async fn handle_request(daemon: &GatewayDaemon, request: IpcRequest) -> IpcResponse {
    match dispatch(daemon, &request.method, request.params).await {
        Ok(result) => IpcResponse {
            id: request.id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => IpcResponse {
            id: request.id,
            ok: false,
            result: None,
            error: Some(error),
        },
    }
}

async fn dispatch(daemon: &GatewayDaemon, method: &str, params: Value) -> Result<Value, String> {
    match namespace(method) {
        "status" => ok_json(daemon.status().await),
        "services" => dispatch_services(daemon, method, params).await,
        "agents" => dispatch_agents(daemon, method, params).await,
        "envelope" => dispatch_envelopes(daemon, method, params).await,
        "registry" => dispatch_registry(daemon, method, params).await,
        "tables" => dispatch_tables(daemon, method, params).await,
        "jobs" => dispatch_jobs(daemon, method, params).await,
        "events" => dispatch_events(daemon, method, params).await,
        "logs" => dispatch_logs(daemon, method, params).await,
        "sandboxes" => dispatch_sandboxes(daemon, method, params).await,
        "workers" => dispatch_workers(daemon, method, params).await,
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

pub(crate) fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| error.to_string())
}

pub(crate) fn ok_json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

fn namespace(method: &str) -> &str {
    method
        .split_once('.')
        .map_or(method, |(namespace, _)| namespace)
}
