use std::{path::Path, sync::Arc};

use serde_json::Value;
use snapdragon_gateway_core::{GatewayWorkerProcessState, ServiceWorkerSpec};
use tokio::{
    fs::{self, File},
    io::AsyncReadExt,
    process::Child,
};

use crate::{
    GatewayDaemon, ServiceRunControl,
    process_tracking::WorkerStream,
    service_worker_output::{PipeCapture, spawn_pipe_reader},
    service_worker_paths::{WorkerOutputPaths, worker_output_paths},
    service_worker_process::{
        ProcessGroupGuard, WaitReason, drain_grace, exit_signal, wait_for_child, worker_command,
    },
};

#[cfg(test)]
use crate::service_worker_output::PREVIEW_BYTES;

const COMPLETION_BYTES: usize = 256 * 1024;

pub(crate) async fn run_service_worker(
    daemon: &GatewayDaemon,
    service: &str,
    worker: &ServiceWorkerSpec,
    timeout_ms: Option<u64>,
    control: Arc<ServiceRunControl>,
) -> Result<Option<String>, String> {
    let paths = worker_output_paths(daemon, service);
    fs::create_dir_all(&paths.root)
        .await
        .map_err(|error| error.to_string())?;
    let mut command = worker_command(worker, &paths.completion);
    let child = command.spawn().map_err(|error| error.to_string())?;
    let process_id = daemon
        .register_worker_process(
            service,
            worker,
            child.id(),
            timeout_ms,
            Some(paths.stdout.display().to_string()),
            Some(paths.stderr.display().to_string()),
        )
        .await;
    let output = match collect_output(daemon, &process_id, child, timeout_ms, control, &paths).await
    {
        Ok(output) => output,
        Err(error) => {
            let _ = fs::remove_file(&paths.completion).await;
            daemon
                .finish_worker_process(
                    &process_id,
                    GatewayWorkerProcessState::Failed,
                    None,
                    None,
                    Some(error.clone()),
                )
                .await;
            return Err(error);
        }
    };
    let (state, error) = match output.reason {
        WaitReason::TimedOut => (
            GatewayWorkerProcessState::TimedOut,
            Some(timeout_message(timeout_ms)),
        ),
        WaitReason::Cancelled => (
            GatewayWorkerProcessState::Cancelled,
            Some("worker cancelled".to_string()),
        ),
        WaitReason::Exited if !output.status.success() => (
            GatewayWorkerProcessState::Failed,
            Some(worker_error(&output)),
        ),
        WaitReason::Exited => (GatewayWorkerProcessState::Exited, None),
    };
    daemon
        .finish_worker_process(
            &process_id,
            state,
            output.status.code(),
            exit_signal(&output.status),
            error.clone(),
        )
        .await;
    if let Some(error) = error {
        let _ = fs::remove_file(&paths.completion).await;
        return Err(error);
    }
    Ok(summary_from_capture(&paths.completion, &output.stdout).await)
}

struct CollectedOutput {
    status: std::process::ExitStatus,
    stdout: PipeCapture,
    stderr: PipeCapture,
    reason: WaitReason,
}

async fn collect_output(
    daemon: &GatewayDaemon,
    process_id: &str,
    mut child: Child,
    timeout_ms: Option<u64>,
    control: Arc<ServiceRunControl>,
    paths: &WorkerOutputPaths,
) -> Result<CollectedOutput, String> {
    let mut guard = ProcessGroupGuard::new(child.id());
    let mut stdout = spawn_pipe_reader(
        daemon.clone(),
        process_id.to_string(),
        child.stdout.take(),
        WorkerStream::Stdout,
        paths.stdout.clone(),
        true,
    );
    let mut stderr = spawn_pipe_reader(
        daemon.clone(),
        process_id.to_string(),
        child.stderr.take(),
        WorkerStream::Stderr,
        paths.stderr.clone(),
        false,
    );
    let (status, reason) = wait_for_child(&mut child, timeout_ms, &control).await?;
    let mut drains = Box::pin(async { tokio::join!(&mut stdout, &mut stderr) });
    let (joined, shutdown) = tokio::join!(
        tokio::time::timeout(drain_grace(), &mut drains),
        guard.shutdown()
    );
    if let Err(error) = shutdown {
        drop(drains);
        stdout.abort();
        stderr.abort();
        return Err(error);
    }
    let joined = match joined {
        Ok(joined) => joined,
        Err(_) => {
            drop(drains);
            stdout.abort();
            stderr.abort();
            return Err("worker output pipes did not close after process-group kill".into());
        }
    };
    let (stdout, stderr) = joined;
    Ok(CollectedOutput {
        status,
        stdout: stdout.map_err(|error| error.to_string())??,
        stderr: stderr.map_err(|error| error.to_string())??,
        reason,
    })
}

fn worker_error(output: &CollectedOutput) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr.preview)
        .trim()
        .to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    let code = output
        .status
        .code()
        .map_or_else(|| "signal".to_string(), |code| code.to_string());
    format!("worker exited with status {code}")
}

fn timeout_message(timeout_ms: Option<u64>) -> String {
    format!(
        "worker timed out after {}ms",
        timeout_ms.unwrap_or_default()
    )
}

async fn summary_from_capture(path: &Path, stdout: &PipeCapture) -> Option<String> {
    let completion = read_bounded_file(path, COMPLETION_BYTES).await;
    let _ = fs::remove_file(path).await;
    completion
        .as_deref()
        .and_then(summary_from_json)
        .or_else(|| summary_from_json(&stdout.completion))
        .or_else(|| {
            let text = String::from_utf8_lossy(&stdout.preview);
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.chars().take(4_096).collect())
        })
}

async fn read_bounded_file(path: &Path, limit: usize) -> Option<Vec<u8>> {
    let file = File::open(path).await.ok()?;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .ok()?;
    (bytes.len() <= limit).then_some(bytes)
}

fn summary_from_json(bytes: &[u8]) -> Option<String> {
    let value = serde_json::from_slice::<Value>(bytes).ok()?;
    value
        .get("summary")
        .and_then(|summary| summary.as_str())
        .map(str::to_string)
}

#[cfg(test)]
#[path = "service_worker_tests.rs"]
mod tests;
