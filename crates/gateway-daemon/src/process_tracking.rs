use snapdragon_gateway_core::{GatewayWorkerProcess, GatewayWorkerProcessState, ServiceWorkerSpec};

use crate::GatewayDaemon;

const RETAIN_FINISHED_WORKERS: usize = 32;

impl GatewayDaemon {
    pub(crate) async fn register_worker_process(
        &self,
        service: &str,
        worker: &ServiceWorkerSpec,
        pid: Option<u32>,
        timeout_ms: Option<u64>,
    ) -> String {
        let now = unix_time_ms();
        let id = format!("worker_{now}_{service}");
        let process = GatewayWorkerProcess {
            id: id.clone(),
            service: service.into(),
            pid,
            command: worker.command.clone(),
            args: worker.args.clone(),
            cwd: worker.cwd.clone(),
            started_at_ms: now,
            finished_at_ms: None,
            timeout_ms,
            state: GatewayWorkerProcessState::Running,
            exit_code: None,
            signal: None,
            last_error: None,
        };
        self.inner
            .write()
            .await
            .worker_processes
            .insert(id.clone(), process);
        id
    }

    pub(crate) async fn finish_worker_process(
        &self,
        id: &str,
        state: GatewayWorkerProcessState,
        exit_code: Option<i32>,
        signal: Option<String>,
        error: Option<String>,
    ) {
        let mut inner = self.inner.write().await;
        if let Some(process) = inner.worker_processes.get_mut(id) {
            process.state = state;
            process.finished_at_ms = Some(unix_time_ms());
            process.exit_code = exit_code;
            process.signal = signal;
            process.last_error = error;
        }
        trim_finished_processes(&mut inner.worker_processes);
    }

    #[cfg(test)]
    pub(crate) async fn worker_process_snapshot(&self) -> Vec<GatewayWorkerProcess> {
        self.inner
            .read()
            .await
            .worker_processes
            .values()
            .cloned()
            .collect()
    }
}

fn trim_finished_processes(
    processes: &mut std::collections::BTreeMap<String, GatewayWorkerProcess>,
) {
    let finished = processes
        .values()
        .filter(|process| process.state != GatewayWorkerProcessState::Running)
        .count();
    if finished <= RETAIN_FINISHED_WORKERS {
        return;
    }
    let remove_count = finished - RETAIN_FINISHED_WORKERS;
    let ids: Vec<String> = processes
        .values()
        .filter(|process| process.state != GatewayWorkerProcessState::Running)
        .take(remove_count)
        .map(|process| process.id.clone())
        .collect();
    for id in ids {
        processes.remove(&id);
    }
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use snapdragon_gateway_core::ServiceWorkerSpec;

    use super::*;

    #[tokio::test]
    async fn process_tracking_records_and_finishes_workers() {
        let daemon = GatewayDaemon::new();
        let worker = ServiceWorkerSpec {
            command: "node".into(),
            args: vec!["worker.js".into()],
            cwd: Some("/tmp".into()),
            env: BTreeMap::new(),
        };
        let id = daemon
            .register_worker_process("svc", &worker, Some(123), Some(500))
            .await;
        daemon
            .finish_worker_process(
                &id,
                GatewayWorkerProcessState::TimedOut,
                None,
                Some("kill".into()),
                Some("timeout".into()),
            )
            .await;
        let [process] = daemon.worker_process_snapshot().await.try_into().unwrap();
        assert_eq!(process.pid, Some(123));
        assert_eq!(process.state, GatewayWorkerProcessState::TimedOut);
        assert_eq!(process.last_error.as_deref(), Some("timeout"));
    }
}
