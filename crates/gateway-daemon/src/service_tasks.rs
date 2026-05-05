use std::time::Duration;

use snapdragon_gateway_core::ServiceSpec;

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

    async fn service_loop(&self, spec: ServiceSpec) {
        if let Some(delay) = spec.startup_delay_ms.filter(|delay| *delay > 0) {
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
        loop {
            let _ = self.run_service_now(&spec.name).await;
            let Some(interval) = spec.interval_ms.filter(|interval| *interval > 0) else {
                return;
            };
            tokio::time::sleep(Duration::from_millis(interval)).await;
        }
    }
}
