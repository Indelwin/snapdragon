use snapdragon_gateway_core::{ServiceRestart, ServiceSpec, ServiceStatus};

use crate::{GatewayDaemon, services_persistence::ServiceLog};

impl GatewayDaemon {
    pub(crate) async fn service_failure_delay(
        &self,
        spec: &ServiceSpec,
        status: &ServiceStatus,
    ) -> Option<u64> {
        if spec.restart == ServiceRestart::Temporary {
            self.record_service_restart_stopped(&spec.name, "temporary service failed")
                .await;
            return None;
        }
        if !self.restart_allowed(spec).await {
            self.record_service_restart_stopped(&spec.name, "restart intensity exceeded")
                .await;
            return None;
        }
        Some(backoff_delay(spec, status.consecutive_errors))
    }

    async fn restart_allowed(&self, spec: &ServiceSpec) -> bool {
        let now = unix_time_ms();
        let mut inner = self.inner.write().await;
        let window = inner
            .service_restart_windows
            .entry(spec.name.clone())
            .or_default();
        window.retain(|at| now.saturating_sub(*at) <= spec.restart_intensity.within_ms);
        window.push(now);
        window.len() as u32 <= spec.restart_intensity.max_restarts
    }

    async fn record_service_restart_stopped(&self, name: &str, reason: &str) {
        let (spec, status) = {
            let mut inner = self.inner.write().await;
            let spec = inner.service_specs.get(name).cloned();
            let Some(status) = inner.services.get_mut(name) else {
                return;
            };
            status.restart_suppressed = true;
            status.last_exit_reason = Some(reason.into());
            status.next_run_at_ms = None;
            (spec, status.clone())
        };
        self.persist_service_status(
            spec.as_ref(),
            Some(&status),
            unix_time_ms(),
            Some(ServiceLog {
                level: "error",
                message: reason,
            }),
        );
    }
}

fn backoff_delay(spec: &ServiceSpec, consecutive_errors: u64) -> u64 {
    let base = spec.backoff_ms.unwrap_or(1_000).max(1);
    let max = spec.max_backoff_ms.unwrap_or(60_000).max(base);
    let exponent = consecutive_errors.saturating_sub(1).min(16);
    base.saturating_mul(2_u64.saturating_pow(exponent as u32))
        .min(max)
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

    use snapdragon_gateway_core::{
        ServiceBudget, ServiceRestart, ServiceRestartIntensity, ServiceWorkerSpec,
    };

    use super::*;

    fn spec() -> ServiceSpec {
        ServiceSpec {
            name: "svc".into(),
            enabled: true,
            interval_ms: Some(1_000),
            startup_delay_ms: None,
            restart: ServiceRestart::Transient,
            restart_intensity: ServiceRestartIntensity::default(),
            backoff_ms: Some(10),
            max_backoff_ms: Some(1_000),
            budget: Some(ServiceBudget {
                max_fuel: None,
                timeout_ms: Some(100),
            }),
            worker: Some(ServiceWorkerSpec {
                command: "sh".into(),
                args: vec!["-c".into(), "exit 1".into()],
                cwd: None,
                env: BTreeMap::new(),
            }),
        }
    }

    #[tokio::test]
    async fn temporary_restart_policy_suppresses_failed_service() {
        let daemon = GatewayDaemon::new();
        let mut spec = spec();
        spec.restart = ServiceRestart::Temporary;
        daemon.register_service(spec.clone()).await;
        daemon.record_service_error("svc", "boom").await;
        let status = daemon.service_status("svc").await.unwrap();
        assert!(daemon.service_failure_delay(&spec, &status).await.is_none());
        assert!(
            daemon
                .service_status("svc")
                .await
                .unwrap()
                .restart_suppressed
        );
    }

    #[tokio::test]
    async fn restart_intensity_suppresses_runaway_failures() {
        let daemon = GatewayDaemon::new();
        let mut spec = spec();
        spec.restart_intensity = ServiceRestartIntensity {
            max_restarts: 1,
            within_ms: 60_000,
        };
        daemon.register_service(spec.clone()).await;
        daemon.record_service_error("svc", "one").await;
        let status = daemon.service_status("svc").await.unwrap();
        assert_eq!(daemon.service_failure_delay(&spec, &status).await, Some(10));
        daemon.record_service_error("svc", "two").await;
        let status = daemon.service_status("svc").await.unwrap();
        assert!(daemon.service_failure_delay(&spec, &status).await.is_none());
    }
}
