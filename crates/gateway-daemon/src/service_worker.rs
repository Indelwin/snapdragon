use std::time::Duration;

use serde_json::Value;
use snapdragon_gateway_core::ServiceWorkerSpec;
use tokio::process::Command;

pub(crate) async fn run_service_worker(
    worker: &ServiceWorkerSpec,
    timeout_ms: Option<u64>,
) -> Result<Option<String>, String> {
    let mut command = Command::new(&worker.command);
    command.args(&worker.args);
    if let Some(cwd) = &worker.cwd {
        command.current_dir(cwd);
    }
    for (key, value) in &worker.env {
        command.env(key, value);
    }
    let run = command.output();
    let output = match timeout_ms {
        Some(ms) if ms > 0 => tokio::time::timeout(Duration::from_millis(ms), run)
            .await
            .map_err(|_| format!("worker timed out after {ms}ms"))?
            .map_err(|error| error.to_string())?,
        _ => run.await.map_err(|error| error.to_string())?,
    };
    if !output.status.success() {
        return Err(worker_error(&output));
    }
    Ok(summary_from_stdout(&String::from_utf8_lossy(
        &output.stdout,
    )))
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
        let summary = run_service_worker(
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
}
