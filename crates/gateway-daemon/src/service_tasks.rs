use std::time::Duration;

use snapdragon_gateway_core::{ServiceSpec, ServiceState, ServiceStatus};

use crate::GatewayDaemon;

impl GatewayDaemon {
    pub(crate) async fn replace_service_task(&self, spec: ServiceSpec) {
        let mut tasks = self.service_tasks.write().await;
        if let Some(task) = tasks.remove(&spec.name) {
            task.abort();
        }
        if !spec.enabled || spec.worker.is_none() {
            return;
        }
        let name = spec.name.clone();
        let daemon = self.clone();
        tasks.insert(
            name,
            tokio::spawn(async move {
                daemon.service_loop(spec).await;
            }),
        );
    }

    pub(crate) async fn remove_service_task(&self, name: &str) {
        if let Some(task) = self.service_tasks.write().await.remove(name) {
            task.abort();
        }
    }

    pub(crate) async fn service_task_names(&self) -> Vec<String> {
        self.service_tasks.read().await.keys().cloned().collect()
    }

    async fn service_loop(&self, spec: ServiceSpec) {
        if let Some(delay) = spec.startup_delay_ms.filter(|delay| *delay > 0) {
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
        loop {
            let Some(status) = self.run_service_now(&spec.name).await else {
                return;
            };
            let Some(delay) = self.next_service_delay(&spec, &status).await else {
                return;
            };
            self.record_service_schedule(&spec.name, delay).await;
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
    }

    async fn next_service_delay(&self, spec: &ServiceSpec, status: &ServiceStatus) -> Option<u64> {
        if !status.enabled || !spec.enabled {
            return None;
        }
        if status.state == ServiceState::Failed {
            return self.service_failure_delay(spec, status).await;
        }
        spec.interval_ms.filter(|interval| *interval > 0)
    }
}
