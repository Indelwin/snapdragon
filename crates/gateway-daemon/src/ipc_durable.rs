use serde_json::{Value, json};
use snapdragon_gateway_core::{GatewayEventRecord, GatewayEventState};

use crate::{
    GatewayDaemon,
    ipc::{ok_json, parse},
    ipc_durable_helpers::{generated_id, normalize_job_spec, unix_time_ms},
    ipc_paging::paged,
    ipc_params::{
        EventRecordParams, JobAcquireParams, JobCompleteParams, JobFailParams, JobIdParams,
        JobRenewParams, JobSpecParams, LogAppendParams, LogTailParams, SandboxLeaseIdParams,
        SandboxLeaseParams, WorkerHeartbeatParams, WorkerIdParams, WorkerRegistrationParams,
    },
};

pub(crate) async fn dispatch_jobs(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "jobs.enqueue" => enqueue_job(daemon, params).await,
        "jobs.list" => paged(params, daemon.list_jobs().await?),
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
            ok_json(require_store(daemon)?.retry_job(&params.id, unix_time_ms())?)
        }
        "jobs.acquire" => acquire_job(daemon, params),
        "jobs.renew" => renew_job(daemon, params),
        "jobs.complete" => finish_job(daemon, params, FinishKind::Complete),
        "jobs.fail" => finish_job(daemon, params, FinishKind::Fail),
        _ => Err(format!("unknown gateway method: {method}")),
    }
}

fn renew_job(daemon: &GatewayDaemon, params: Value) -> Result<Value, String> {
    let params = parse::<JobRenewParams>(params)?;
    ok_json(
        require_store(daemon)?
            .renew_job(
                &params.id,
                &params.lease_id,
                params.attempt,
                params.lease_ms.unwrap_or(300_000),
                unix_time_ms(),
            )?
            .map(|(job, lease)| json!({ "job": job, "lease": lease })),
    )
}

pub(crate) async fn dispatch_events(
    daemon: &GatewayDaemon,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    match method {
        "events.append" => append_event(daemon, params),
        "events.list" => paged(params, require_store(daemon)?.list_events()?),
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
                    .tail_logs(
                        params.target.as_deref(),
                        params.limit.unwrap_or(20).clamp(1, 100),
                    )
                    .await?,
            )
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
            ok_json(
                daemon
                    .register_worker(params.worker, unix_time_ms())
                    .await?,
            )
        }
        "workers.heartbeat" => {
            let params = parse::<WorkerHeartbeatParams>(params)?;
            ok_json(
                daemon
                    .heartbeat_worker(params.heartbeat, unix_time_ms())
                    .await?,
            )
        }
        "workers.list" => paged(params, daemon.list_workers().await?),
        "workers.show" => {
            let params = parse::<WorkerIdParams>(params)?;
            ok_json(daemon.worker(&params.id).await?)
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
        "sandboxes.register" => {
            let params = parse::<SandboxLeaseParams>(params)?;
            ok_json(
                daemon
                    .register_sandbox_lease(params.lease, unix_time_ms())
                    .await?,
            )
        }
        "sandboxes.list" => paged(params, daemon.list_sandbox_leases().await?),
        "sandboxes.show" => {
            let params = parse::<SandboxLeaseIdParams>(params)?;
            ok_json(daemon.sandbox_lease(&params.id).await?)
        }
        "sandboxes.release" => {
            let params = parse::<SandboxLeaseIdParams>(params)?;
            ok_json(
                daemon
                    .release_sandbox_lease(&params.id, unix_time_ms())
                    .await?,
            )
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
            ok_json(store.complete_job(
                &params.id,
                &params.lease_id,
                params.attempt,
                params.result,
                now,
            )?)
        }
        FinishKind::Fail => {
            let params = parse::<JobFailParams>(params)?;
            ok_json(store.fail_job(
                &params.id,
                &params.lease_id,
                params.attempt,
                params.error,
                now,
            )?)
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
