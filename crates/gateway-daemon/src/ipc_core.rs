use serde_json::{Value, json};

use crate::{
    GatewayDaemon,
    ipc::{ok_json, parse},
    ipc_params::{
        AgentRuntimeIdParams, AgentRuntimeParams, CapabilityLookupParams, CapabilityParams,
        EnvelopeParams, ReceiveParams, ServiceEnableParams, ServiceErrorParams, ServiceNameParams,
        ServiceRunParams, ServiceSpecParams, TableCreateParams, TableNameParams,
    },
};

pub(crate) async fn dispatch_services(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
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
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

pub(crate) async fn dispatch_envelopes(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "envelope.send" => {
            daemon.send(parse::<EnvelopeParams>(params)?.envelope).await;
            Ok(json!(true))
        }
        "envelope.receive" => {
            let params = parse::<ReceiveParams>(params)?;
            ok_json(daemon.receive(&params.actor, &params.filter).await)
        }
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

pub(crate) async fn dispatch_registry(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
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
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

pub(crate) async fn dispatch_agents(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "agents.register" => {
            let params = parse::<AgentRuntimeParams>(params)?;
            ok_json(daemon.register_agent_runtime(params.descriptor).await)
        }
        "agents.list" => ok_json(daemon.list_agent_runtimes().await),
        "agents.show" => {
            let params = parse::<AgentRuntimeIdParams>(params)?;
            ok_json(daemon.agent_runtime(&params.id).await)
        }
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

pub(crate) async fn dispatch_tables(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
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
