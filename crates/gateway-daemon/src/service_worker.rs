use std::time::Duration;

use serde_json::Value;
use snapdragon_gateway_core::{GatewayWorkerProcessState, ServiceWorkerSpec};
use tokio::{
    io::AsyncReadExt,
    process::{Child, ChildStderr, ChildStdout, Command},
};

use crate::GatewayDaemon;

pub(crate) async fn run_service_worker(
    daemon: &GatewayDaemon,
    service: &str,
    worker: &ServiceWorkerSpec,
    timeout_ms: Option<u64>,
) -> Result<Option<String>, String> {
    let mut command = Command::new(&worker.command);
    command.args(&worker.args);
    command.kill_on_drop(true);
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    if let Some(cwd) = &worker.cwd {
        command.current_dir(cwd);
    }
    for (key, value) in &worker.env {
        command.env(key, value);
    }
    let child = command.spawn().map_err(|error| error.to_string())?;
    let pid = child.id();
    let process_id = daemon
        .register_worker_process(service, worker, pid, timeout_ms)
        .await;
    let (output, timed_out) = collect_output(child, timeout_ms).await?;
    if timed_out {
        let message = timeout_message(timeout_ms);
        daemon
            .finish_worker_process(
                &process_id,
                GatewayWorkerProcessState::TimedOut,
                output.status.code(),
                exit_signal(&output.status),
                Some(message.clone()),
            )
            .await;
        return Err(message);
    }
    if !output.status.success() {
        let message = worker_error(&output);
        daemon
            .finish_worker_process(
                &process_id,
                GatewayWorkerProcessState::Failed,
                output.status.code(),
                exit_signal(&output.status),
                Some(message.clone()),
            )
            .await;
        return Err(message);
    }
    daemon
        .finish_worker_process(
            &process_id,
            GatewayWorkerProcessState::Exited,
            output.status.code(),
            exit_signal(&output.status),
            None,
        )
        .await;
    Ok(summary_from_stdout(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

async fn collect_output(
    mut child: Child,
    timeout_ms: Option<u64>,
) -> Result<(std::process::Output, bool), String> {
    let stdout = tokio::spawn(read_stdout(child.stdout.take()));
    let stderr = tokio::spawn(read_stderr(child.stderr.take()));
    let (status, timed_out) = wait_with_timeout(&mut child, timeout_ms).await?;
    Ok((
        std::process::Output {
            status,
            stdout: stdout.await.map_err(|error| error.to_string())??,
            stderr: stderr.await.map_err(|error| error.to_string())??,
        },
        timed_out,
    ))
}

async fn wait_with_timeout(
    child: &mut Child,
    timeout_ms: Option<u64>,
) -> Result<(std::process::ExitStatus, bool), String> {
    let Some(ms) = timeout_ms.filter(|ms| *ms > 0) else {
        return child
            .wait()
            .await
            .map(|status| (status, false))
            .map_err(|error| error.to_string());
    };
    tokio::select! {
        result = child.wait() => result.map(|status| (status, false)).map_err(|error| error.to_string()),
        _ = tokio::time::sleep(Duration::from_millis(ms)) => {
            let _ = child.start_kill();
            child.wait().await.map(|status| (status, true)).map_err(|error| error.to_string())
        }
    }
}

async fn read_stdout(stdout: Option<ChildStdout>) -> Result<Vec<u8>, String> {
    read_pipe(stdout).await
}

async fn read_stderr(stderr: Option<ChildStderr>) -> Result<Vec<u8>, String> {
    read_pipe(stderr).await
}

async fn read_pipe<T>(pipe: Option<T>) -> Result<Vec<u8>, String>
where
    T: tokio::io::AsyncRead + Unpin,
{
    let Some(mut pipe) = pipe else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    pipe.read_to_end(&mut out)
        .await
        .map_err(|error| error.to_string())?;
    Ok(out)
}

fn worker_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
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

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(|signal| signal.to_string())
}

#[cfg(not(unix))]
fn exit_signal(_status: &std::process::ExitStatus) -> Option<String> {
    None
}

fn summary_from_stdout(stdout: &str) -> Option<String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return value
            .get("summary")
            .and_then(|summary| summary.as_str())
            .map(|summary| summary.to_string());
    }
    Some(trimmed.chars().take(4_096).collect())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    #[tokio::test]
    async fn service_worker_extracts_json_summary() {
        let daemon = GatewayDaemon::new();
        let summary = run_service_worker(
            &daemon,
            "svc",
            &ServiceWorkerSpec {
                command: "sh".into(),
                args: vec![
                    "-c".into(),
                    r#"printf '{"summary":"worker summary"}'"#.into(),
                ],
                cwd: None,
                env: BTreeMap::new(),
            },
            Some(1_000),
        )
        .await
        .unwrap();
        assert_eq!(summary.as_deref(), Some("worker summary"));
    }

    #[tokio::test]
    async fn service_worker_kills_and_records_timeout() {
        let daemon = GatewayDaemon::new();
        let error = run_service_worker(
            &daemon,
            "svc",
            &ServiceWorkerSpec {
                command: "sh".into(),
                args: vec!["-c".into(), "sleep 2".into()],
                cwd: None,
                env: BTreeMap::new(),
            },
            Some(25),
        )
        .await
        .unwrap_err();
        assert!(error.contains("timed out"));
        let [process] = daemon.worker_process_snapshot().await.try_into().unwrap();
        assert_eq!(process.state, GatewayWorkerProcessState::TimedOut);
    }
}
