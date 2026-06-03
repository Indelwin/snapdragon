use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};
use snapdragon_gateway_core::{GatewayEventRecord, GatewayEventState, GatewayJobSpec};

use crate::{
    GatewayDaemon,
    ipc::{ok_json, parse},
    ipc_params::{
        EventRecordParams, JobAcquireParams, JobCompleteParams, JobFailParams, JobIdParams,
        JobSpecParams, LogAppendParams, LogTailParams, SandboxIdParams, SandboxLeaseParams,
        WorkerHeartbeatParams, WorkerIdParams, WorkerRegistrationParams,
    },
};

pub(crate) async fn dispatch_jobs(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "jobs.enqueue" => enqueue_job(daemon, params).await,
        "jobs.list" => ok_json(daemon.list_jobs().await?),
        "jobs.show" => {
            let params = parse::<JobIdParams>(params)?;
            ok_json(daemon.job(&params.id).await?)
        }
        "jobs.cancel" => {
            let params = parse::<JobIdParams>(params)?;
            ok_json(daemon.cancel_job(&params.id, unix_time_ms()).await?)
        }
        "jobs.retry" => {
            let params = parse::<JobIdParams>(params)?;
            ok_json(daemon.retry_job(&params.id, unix_time_ms()).await?)
        }
        "jobs.acquire" => acquire_job(daemon, params),
        "jobs.complete" => finish_job(daemon, params, FinishKind::Complete),
        "jobs.fail" => finish_job(daemon, params, FinishKind::Fail),
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

pub(crate) async fn dispatch_events(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "events.append" => append_event(daemon, params),
        "events.list" => ok_json(require_store(daemon)?.list_events()?),
        "events.cancel" => {
            let params = parse::<JobIdParams>(params)?;
            ok_json(require_store(daemon)?.cancel_event(&params.id, unix_time_ms())?)
        }
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

pub(crate) async fn dispatch_logs(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "logs.append" => append_log(daemon, params),
        "logs.tail" => {
            let params = parse::<LogTailParams>(params)?;
            ok_json(
                daemon
                    .tail_logs(params.target.as_deref(), params.limit.unwrap_or(20))
                    .await?,
            )
        }
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

pub(crate) async fn dispatch_sandboxes(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "sandboxes.lease" => {
            let params = parse::<SandboxLeaseParams>(params)?;
            ok_json(daemon.lease_sandbox(params.spec, unix_time_ms()).await?)
        }
        "sandboxes.list" => ok_json(daemon.list_sandbox_leases().await?),
        "sandboxes.show" => {
            let params = parse::<SandboxIdParams>(params)?;
            ok_json(daemon.sandbox_lease(&params.id).await?)
        }
        "sandboxes.release" => {
            let params = parse::<SandboxIdParams>(params)?;
            ok_json(daemon.release_sandbox(&params.id).await?)
        }
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

pub(crate) async fn dispatch_workers(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "workers.register" => {
            let params = parse::<WorkerRegistrationParams>(params)?;
            ok_json(daemon.register_worker(params.worker).await?)
        }
        "workers.heartbeat" => {
            let params = parse::<WorkerHeartbeatParams>(params)?;
            ok_json(daemon.heartbeat_worker(params.heartbeat).await?)
        }
        "workers.list" => ok_json(daemon.list_workers().await?),
        "workers.show" => {
            let params = parse::<WorkerIdParams>(params)?;
            ok_json(daemon.worker(&params.id).await?)
        }
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

async fn enqueue_job(daemon: &GatewayDaemon, params: Value) -> Result<Value, String> {
    let params = parse::<JobSpecParams>(params)?;
    ok_json(
        daemon
            .enqueue_job(
                params.id.unwrap_or_else(|| generated_id("job")),
                normalize_job_spec(params.spec),
                unix_time_ms(),
            )
            .await?,
    )
}

fn acquire_job(daemon: &GatewayDaemon, params: Value) -> Result<Value, String> {
    let params = parse::<JobAcquireParams>(params)?;
    ok_json(
        require_store(daemon)?
            .acquire_job(
                params.queue.as_deref().unwrap_or("default"),
                &params.worker,
                params.lease_ms.unwrap_or(300_000),
                unix_time_ms(),
            )?
            .map(|(job, lease)| json!({ "job": job, "lease": lease })),
    )
}

fn finish_job(daemon: &GatewayDaemon, params: Value, kind: FinishKind) -> Result<Value, String> {
    let store = require_store(daemon)?;
    let now = unix_time_ms();
    match kind {
        FinishKind::Complete => {
            let params = parse::<JobCompleteParams>(params)?;
            ok_json(store.complete_job(&params.id, params.result, now)?)
        }
        FinishKind::Fail => {
            let params = parse::<JobFailParams>(params)?;
            ok_json(store.fail_job(&params.id, params.error, now)?)
        }
    }
}

fn append_event(daemon: &GatewayDaemon, params: Value) -> Result<Value, String> {
    let params = parse::<EventRecordParams>(params)?;
    let now = unix_time_ms();
    ok_json(require_store(daemon)?.append_event(GatewayEventRecord {
        id: params.id.unwrap_or_else(|| generated_id("event")),
        kind: params.kind,
        target: params.target,
        state: GatewayEventState::Pending,
        payload: params.payload,
        created_at_ms: now,
        updated_at_ms: now,
    })?)
}

fn append_log(daemon: &GatewayDaemon, params: Value) -> Result<Value, String> {
    let params = parse::<LogAppendParams>(params)?;
    ok_json(require_store(daemon)?.append_log(
        params.at_ms,
        params.level.as_deref().unwrap_or("info"),
        params.target.as_deref(),
        &params.message,
        params.data,
    )?)
}

enum FinishKind {
    Complete,
    Fail,
}

fn require_store(daemon: &GatewayDaemon) -> Result<&crate::GatewayStore, String> {
    daemon
        .store()
        .ok_or_else(|| "gateway durable store is not configured".to_string())
}

fn normalize_job_spec(mut spec: GatewayJobSpec) -> GatewayJobSpec {
    if spec.queue.is_empty() {
        spec.queue = "default".into();
    }
    if spec.max_attempts == 0 {
        spec.max_attempts = 1;
    }
    spec
}

fn generated_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}_{nanos}")
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
