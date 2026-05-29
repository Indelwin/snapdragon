use serde::{Deserialize, Serialize};
use snapdragon_gateway_core::{
    GatewayAgentRuntimeDescriptor, GatewayJobState, GatewayJobStatus, GatewayLease,
    GatewayLogRecord, GatewayQueueDepth, GatewayWorkerProcess, GatewayWorkerProcessState,
    ServiceStatus,
};

use crate::GatewayDaemon;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GatewayStatusSnapshot {
    pub services: Vec<ServiceStatus>,
    pub agent_runtimes: Vec<GatewayAgentRuntimeDescriptor>,
    pub processes: usize,
    pub worker_processes: Vec<GatewayWorkerProcess>,
    pub tables: Vec<String>,
    pub service_tasks: Vec<String>,
    pub jobs_pending: usize,
    pub jobs_running: usize,
    pub active_leases: Vec<GatewayLease>,
    pub queue_depths: Vec<GatewayQueueDepth>,
    pub recent_logs: Vec<GatewayLogRecord>,
    pub recent_failures: Vec<GatewayLogRecord>,
    pub uptime_ms: u64,
    pub pid: u32,
}

impl GatewayDaemon {
    pub async fn status(&self) -> GatewayStatusSnapshot {
        let _ = self.run_watchdogs().await;
        let now = unix_time_ms();
        let inner = self.inner.read().await;
        let worker_processes: Vec<_> = inner.worker_processes.values().cloned().collect();
        let jobs = self.store.as_ref().and_then(|store| store.list_jobs().ok());
        GatewayStatusSnapshot {
            services: inner.services.values().cloned().collect(),
            agent_runtimes: inner.agent_runtimes.values().cloned().collect(),
            processes: inner.mailboxes.len() + running_workers(&worker_processes),
            worker_processes,
            tables: inner.tables.table_names(),
            service_tasks: self.service_task_names().await,
            jobs_pending: count_jobs(&jobs, GatewayJobState::Pending),
            jobs_running: count_jobs(&jobs, GatewayJobState::Running),
            active_leases: self
                .store
                .as_ref()
                .and_then(|store| store.active_leases(now).ok())
                .unwrap_or_default(),
            queue_depths: self
                .store
                .as_ref()
                .and_then(|store| store.queue_depths().ok())
                .unwrap_or_default(),
            recent_logs: self
                .store
                .as_ref()
                .and_then(|store| store.tail_logs(None, 5).ok())
                .unwrap_or_default(),
            recent_failures: self
                .store
                .as_ref()
                .and_then(|store| store.recent_failures(5).ok())
                .unwrap_or_default(),
            uptime_ms: now.saturating_sub(self.started_at_ms),
            pid: std::process::id(),
        }
    }
}

fn running_workers(processes: &[GatewayWorkerProcess]) -> usize {
    processes
        .iter()
        .filter(|process| process.state == GatewayWorkerProcessState::Running)
        .count()
}

fn count_jobs(jobs: &Option<Vec<GatewayJobStatus>>, state: GatewayJobState) -> usize {
    jobs.as_ref()
        .map(|jobs| jobs.iter().filter(|job| job.state == state).count())
        .unwrap_or(0)
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
