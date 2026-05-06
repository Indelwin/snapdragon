use std::time::{SystemTime, UNIX_EPOCH};

use snapdragon_gateway_core::{ServiceSpec, ServiceState, ServiceStatus};

use crate::{GatewayDaemon, service_worker::run_service_worker, services_persistence::ServiceLog};

impl GatewayDaemon {
    pub async fn register_service(&self, spec: ServiceSpec) {
        let name = spec.name.clone();
        {
            let mut inner = self.inner.write().await;
            let existing = inner.services.get(&name).cloned();
            inner.service_specs.insert(name.clone(), spec.clone());
            inner
                .services
                .insert(name.clone(), initial_service_status(&name, &spec, existing));
        }
        let status = self.service_status(&name).await;
        self.persist_service_status(Some(&spec), status.as_ref(), unix_time_ms(), None);
        self.replace_service_task(spec).await;
    }

    pub async fn run_service_now(&self, name: &str) -> Option<ServiceStatus> {
        let spec = {
            let inner = self.inner.read().await;
            inner.service_specs.get(name).cloned()
        }?;
        {
            let mut inner = self.inner.write().await;
            let status = inner.services.get_mut(name)?;
            if !status.enabled || !spec.enabled {
                status.state = ServiceState::Stopped;
                return Some(status.clone());
            }
            status.state = ServiceState::Starting;
        }
        let result = match spec.worker.as_ref() {
            Some(worker) => {
                run_service_worker(
                    self,
                    &spec.name,
                    worker,
                    spec.budget.as_ref().and_then(|budget| budget.timeout_ms),
                )
                .await
            }
            None => Ok(None),
        };
        match result {
            Ok(summary) => self.record_service_run(name, unix_time_ms(), summary).await,
            Err(error) => self.record_service_error(name, error).await,
        }
        self.service_status(name).await
    }

    pub async fn record_service_run(&self, name: &str, at_ms: u64, summary: Option<String>) {
        let mut inner = self.inner.write().await;
        let spec = inner.service_specs.get(name).cloned();
        if let Some(status) = inner.services.get_mut(name) {
            status.runs = status.runs.saturating_add(1);
            status.consecutive_errors = 0;
            status.last_run_at_ms = Some(at_ms);
            status.last_summary = summary;
            status.state = ServiceState::Running;
            status.restart_suppressed = false;
            status.next_run_at_ms = None;
            status.last_exit_reason = Some("ok".into());
            self.persist_service_status(
                spec.as_ref(),
                Some(status),
                at_ms,
                Some(ServiceLog {
                    level: "info",
                    message: "service run completed",
                }),
            );
        }
    }

    pub async fn record_service_error(&self, name: &str, error: impl Into<String>) {
        let mut inner = self.inner.write().await;
        let spec = inner.service_specs.get(name).cloned();
        if let Some(status) = inner.services.get_mut(name) {
            status.errors = status.errors.saturating_add(1);
            status.consecutive_errors = status.consecutive_errors.saturating_add(1);
            status.last_error = Some(error.into());
            status.state = ServiceState::Failed;
            status.next_run_at_ms = None;
            status.last_exit_reason = status.last_error.clone();
            let now = unix_time_ms();
            let message = status.last_error.as_deref().unwrap_or("service failed");
            self.persist_service_status(
                spec.as_ref(),
                Some(status),
                now,
                Some(ServiceLog {
                    level: "error",
                    message,
                }),
            );
        }
    }

    pub async fn service_status(&self, name: &str) -> Option<ServiceStatus> {
        self.inner.read().await.services.get(name).cloned()
    }

    pub async fn set_service_enabled(&self, name: &str, enabled: bool) -> Option<ServiceStatus> {
        let spec = {
            let mut inner = self.inner.write().await;
            let spec = inner.service_specs.get_mut(name)?;
            spec.enabled = enabled;
            let spec = spec.clone();
            let status = inner.services.get_mut(name)?;
            status.enabled = enabled;
            status.state = if enabled {
                ServiceState::Running
            } else {
                ServiceState::Stopped
            };
            status.next_run_at_ms = None;
            status.restart_suppressed = false;
            spec
        };
        if enabled {
            self.replace_service_task(spec.clone()).await;
        } else {
            self.remove_service_task(name).await;
        }
        let status = self.service_status(name).await;
        self.persist_service_status(Some(&spec), status.as_ref(), unix_time_ms(), None);
        self.service_status(name).await
    }

    pub async fn list_services(&self) -> Vec<ServiceStatus> {
        self.inner.read().await.services.values().cloned().collect()
    }

    pub(crate) async fn record_service_schedule(&self, name: &str, delay_ms: u64) {
        let next = unix_time_ms().saturating_add(delay_ms);
        let (spec, status) = {
            let mut inner = self.inner.write().await;
            let spec = inner.service_specs.get(name).cloned();
            let Some(status) = inner.services.get_mut(name) else {
                return;
            };
            status.next_run_at_ms = Some(next);
            (spec, status.clone())
        };
        self.persist_service_status(spec.as_ref(), Some(&status), unix_time_ms(), None);
    }
}

fn initial_service_status(
    name: &str,
    spec: &ServiceSpec,
    existing: Option<ServiceStatus>,
) -> ServiceStatus {
    ServiceStatus {
        name: name.into(),
        enabled: spec.enabled,
        state: if spec.enabled {
            ServiceState::Running
        } else {
            ServiceState::Stopped
        },
        runs: existing.as_ref().map_or(0, |status| status.runs),
        errors: existing.as_ref().map_or(0, |status| status.errors),
        consecutive_errors: existing
            .as_ref()
            .map_or(0, |status| status.consecutive_errors),
        last_run_at_ms: existing.as_ref().and_then(|status| status.last_run_at_ms),
        last_error: existing
            .as_ref()
            .and_then(|status| status.last_error.clone()),
        last_summary: existing
            .as_ref()
            .and_then(|status| status.last_summary.clone()),
        restart_suppressed: false,
        next_run_at_ms: None,
        last_exit_reason: existing.and_then(|status| status.last_exit_reason),
    }
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use snapdragon_gateway_core::{ServiceBudget, ServiceSpec, ServiceWorkerSpec};

    use super::*;

    #[tokio::test]
    async fn daemon_tracks_service_runs_and_errors() {
        let daemon = GatewayDaemon::new();
        daemon
            .register_service(test_service("memory-worker", None))
            .await;
        daemon
            .record_service_run("memory-worker", 10, Some("ok".into()))
            .await;
        daemon.record_service_error("memory-worker", "boom").await;
        let status = daemon.status().await;
        assert_eq!(status.services[0].runs, 1);
        assert_eq!(status.services[0].errors, 1);
        assert_eq!(status.services[0].last_error.as_deref(), Some("boom"));
    }

    #[tokio::test]
    async fn daemon_executes_service_worker_on_demand() {
        let daemon = GatewayDaemon::new();
        let worker = ServiceWorkerSpec {
            command: "sh".into(),
            args: vec![
                "-c".into(),
                r#"printf '{"summary":"indexed 2 sessions"}'"#.into(),
            ],
            cwd: None,
            env: BTreeMap::new(),
        };
        daemon
            .register_service(test_service("session-index", Some(worker)))
            .await;

        let status = daemon.run_service_now("session-index").await.unwrap();
        assert_eq!(status.runs, 1);
        assert_eq!(status.errors, 0);
        assert_eq!(status.last_summary.as_deref(), Some("indexed 2 sessions"));
    }

    fn test_service(name: &str, worker: Option<ServiceWorkerSpec>) -> ServiceSpec {
        ServiceSpec {
            name: name.into(),
            enabled: true,
            interval_ms: None,
            startup_delay_ms: None,
            restart: Default::default(),
            restart_intensity: Default::default(),
            backoff_ms: None,
            max_backoff_ms: None,
            budget: Some(ServiceBudget {
                max_fuel: None,
                timeout_ms: Some(1_000),
            }),
            worker,
        }
    }
}
