use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use snapdragon_gateway_core::{ActorId, GatewayEnvelope, ReceiveFilter, ServiceSpec, TableAccess};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::GatewayDaemon;

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

#[derive(Debug, Deserialize)]
struct ServiceSpecParams {
    spec: ServiceSpec,
}

#[derive(Debug, Deserialize)]
struct ServiceNameParams {
    name: String,
}

#[derive(Debug, Deserialize)]
struct ServiceEnableParams {
    name: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
struct ServiceRunParams {
    name: String,
    at_ms: u64,
    summary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServiceErrorParams {
    name: String,
    error: String,
}

#[derive(Debug, Deserialize)]
struct EnvelopeParams {
    envelope: GatewayEnvelope,
}

#[derive(Debug, Deserialize)]
struct ReceiveParams {
    actor: ActorId,
    #[serde(default)]
    filter: ReceiveFilter,
}

#[derive(Debug, Deserialize)]
struct CapabilityParams {
    capability: String,
    actor: ActorId,
}

#[derive(Debug, Deserialize)]
struct CapabilityLookupParams {
    capability: String,
}

#[derive(Debug, Deserialize)]
struct TableCreateParams {
    name: String,
    owner: ActorId,
    access: TableAccess,
}

#[derive(Debug, Deserialize)]
struct TableNameParams {
    name: String,
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
    match method {
        "status" => ok_json(daemon.status().await),
        "services.list" => ok_json(daemon.list_services().await),
        "services.register" => {
            daemon
                .register_service(parse::<ServiceSpecParams>(params)?.spec)
                .await;
            Ok(json!(true))
        }
        "services.run" => {
            let params = parse::<ServiceNameParams>(params)?;
            ok_json(daemon.run_service_now(&params.name).await)
        }
        "services.record_run" => {
            let params = parse::<ServiceRunParams>(params)?;
            daemon
                .record_service_run(&params.name, params.at_ms, params.summary)
                .await;
            ok_json(daemon.service_status(&params.name).await)
        }
        "services.error" => {
            let params = parse::<ServiceErrorParams>(params)?;
            daemon
                .record_service_error(&params.name, params.error)
                .await;
            ok_json(daemon.service_status(&params.name).await)
        }
        "services.status" => {
            let params = parse::<ServiceNameParams>(params)?;
            ok_json(daemon.service_status(&params.name).await)
        }
        "services.enable" => {
            let params = parse::<ServiceEnableParams>(params)?;
            ok_json(
                daemon
                    .set_service_enabled(&params.name, params.enabled)
                    .await,
            )
        }
        "envelope.send" => {
            daemon.send(parse::<EnvelopeParams>(params)?.envelope).await;
            Ok(json!(true))
        }
        "envelope.receive" => {
            let params = parse::<ReceiveParams>(params)?;
            ok_json(daemon.receive(&params.actor, &params.filter).await)
        }
        "registry.register_capability" => {
            let params = parse::<CapabilityParams>(params)?;
            daemon
                .register_capability(params.capability, params.actor)
                .await;
            Ok(json!(true))
        }
        "registry.whereis_capability" => {
            let params = parse::<CapabilityLookupParams>(params)?;
            ok_json(daemon.capability_providers(&params.capability).await)
        }
        "registry.list" => ok_json(daemon.registry_snapshot().await),
        "tables.create" => {
            let params = parse::<TableCreateParams>(params)?;
            ok_json(
                daemon
                    .create_table(params.name, params.owner, params.access)
                    .await,
            )
        }
        "tables.list" => ok_json(daemon.table_names().await),
        "tables.show" => {
            let params = parse::<TableNameParams>(params)?;
            ok_json(daemon.table_snapshot(&params.name).await)
        }
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| error.to_string())
}

fn ok_json(value: impl Serialize) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}
