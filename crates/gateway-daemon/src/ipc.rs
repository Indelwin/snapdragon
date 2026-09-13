use std::{io, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::task::JoinSet;

use crate::{
    GatewayDaemon,
    ipc_core::{
        dispatch_agents, dispatch_envelopes, dispatch_registry, dispatch_services, dispatch_tables,
    },
    ipc_durable::{
        dispatch_events, dispatch_jobs, dispatch_logs, dispatch_sandboxes, dispatch_workers,
    },
    ipc_frame::{Frame, read_frame},
    ipc_ownership::SocketOwnership,
};

pub const MAX_IPC_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_IPC_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_IPC_CLIENTS: usize = 128;
const BUSY_RESPONSE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(100);

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
    let ownership = SocketOwnership::acquire(path.as_ref()).await?;
    let listener = UnixListener::bind(ownership.socket_path())?;
    let mut clients = JoinSet::new();
    loop {
        tokio::select! {
            _ = daemon.shutdown_signal.cancelled() => break,
            completed = clients.join_next(), if !clients.is_empty() => {
                let _ = completed;
            },
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                if clients.len() >= MAX_IPC_CLIENTS {
                    reject_busy(stream).await;
                    continue;
                }
                let daemon = daemon.clone();
                clients.spawn(async move {
                    let _ = handle_client(daemon, stream).await;
                });
            }
        }
    }
    drop(listener);
    while clients.join_next().await.is_some() {}
    Ok(())
}

async fn handle_client(daemon: GatewayDaemon, stream: UnixStream) -> io::Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    loop {
        let frame = tokio::select! {
            _ = daemon.shutdown_signal.cancelled() => return Ok(()),
            frame = read_frame(&mut reader, MAX_IPC_FRAME_BYTES) => frame?,
        };
        let response = match frame {
            Frame::End => return Ok(()),
            Frame::Oversized => error_response(
                0,
                format!("gateway IPC frame exceeds {MAX_IPC_FRAME_BYTES} bytes"),
            ),
            Frame::Data(frame) => tokio::select! {
                _ = daemon.shutdown_signal.cancelled() => return Ok(()),
                response = handle_line(&daemon, &frame) => response,
            },
        };
        tokio::select! {
            _ = daemon.shutdown_signal.cancelled() => return Ok(()),
            written = write_response(&mut writer, response) => written?,
        }
    }
}

async fn reject_busy(mut stream: UnixStream) {
    let response = error_response(
        0,
        format!("gateway IPC is busy (maximum {MAX_IPC_CLIENTS} clients)"),
    );
    let mut encoded = serde_json::to_vec(&response).unwrap_or_default();
    encoded.push(b'\n');
    let _ = tokio::time::timeout(BUSY_RESPONSE_TIMEOUT, stream.write_all(&encoded)).await;
}

async fn write_response(
    writer: &mut tokio::net::unix::OwnedWriteHalf,
    response: IpcResponse,
) -> io::Result<()> {
    let id = response.id;
    let mut encoded = serde_json::to_vec(&response)?;
    if encoded.len() > MAX_IPC_RESPONSE_BYTES {
        encoded = serde_json::to_vec(&error_response(
            id,
            format!("gateway IPC response exceeds {MAX_IPC_RESPONSE_BYTES} bytes"),
        ))?;
    }
    encoded.push(b'\n');
    writer.write_all(&encoded).await
}

async fn handle_line(daemon: &GatewayDaemon, line: &[u8]) -> IpcResponse {
    match serde_json::from_slice::<IpcRequest>(line) {
        Ok(request) => handle_request(daemon, request).await,
        Err(error) => error_response(0, format!("malformed gateway IPC request: {error}")),
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
        Err(error) => error_response(request.id, error),
    }
}

fn error_response(id: u64, error: String) -> IpcResponse {
    IpcResponse {
        id,
        ok: false,
        result: None,
        error: Some(error),
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
        "workers" => dispatch_workers(daemon, method, params).await,
        "sandboxes" => dispatch_sandboxes(daemon, method, params).await,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn limited_frame_reader_drains_oversized_frames_and_continues() {
        let input = b"123456789\nok\n";
        let mut reader = BufReader::new(&input[..]);
        assert!(matches!(
            read_frame(&mut reader, 4).await.unwrap(),
            Frame::Oversized
        ));
        let Frame::Data(next) = read_frame(&mut reader, 4).await.unwrap() else {
            panic!("expected following frame");
        };
        assert_eq!(next, b"ok");
    }
}
