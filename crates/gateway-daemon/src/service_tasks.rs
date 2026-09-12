use std::sync::Arc;

use snapdragon_gateway_core::ServiceSpec;

use crate::{GatewayDaemon, ServiceRunControl, lifecycle::wait_or_cancel};

impl GatewayDaemon {
    pub(crate) async fn service_lifecycle_gate(&self, name: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut gates = self.service_lifecycle_gates.lock().await;
        Arc::clone(
            gates
                .entry(name.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
        )
    }

    pub(crate) async fn replace_service_task_locked(&self, spec: ServiceSpec) {
        self.stop_service_task(&spec.name).await;
        let control = Arc::new(ServiceRunControl::default());
        self.service_controls
            .lock()
            .await
            .insert(spec.name.clone(), Arc::clone(&control));
        if self.shutdown_signal.is_cancelled() || !spec.enabled || spec.worker.is_none() {
            return;
        }
        let name = spec.name.clone();
        let daemon = self.clone();
        self.service_tasks.write().await.insert(
            name,
            tokio::spawn(async move {
                daemon.service_loop(spec, control).await;
            }),
        );
    }

    pub(crate) async fn remove_service_task_locked(&self, name: &str) {
        self.stop_service_task(name).await;
        self.service_controls.lock().await.remove(name);
    }

    pub(crate) async fn stop_all_service_tasks(&self) {
        let names = self
            .service_controls
            .lock()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for name in names {
            let lifecycle = self.service_lifecycle_gate(&name).await;
            let _lifecycle_guard = lifecycle.lock().await;
            self.stop_service_task(&name).await;
            self.service_controls.lock().await.remove(&name);
        }
    }

    pub(crate) async fn service_task_names(&self) -> Vec<String> {
        self.service_tasks.read().await.keys().cloned().collect()
    }

    pub(crate) async fn service_control_locked(&self, name: &str) -> Arc<ServiceRunControl> {
        let mut controls = self.service_controls.lock().await;
        Arc::clone(
            controls
                .entry(name.to_string())
                .or_insert_with(|| Arc::new(ServiceRunControl::default())),
        )
    }

    async fn stop_service_task(&self, name: &str) {
        let control = self.service_controls.lock().await.get(name).cloned();
        if let Some(control) = &control {
            control.cancel();
        }
        let task = self.service_tasks.write().await.remove(name);
        if let Some(task) = task {
            let _ = task.await;
        }
        if let Some(control) = control {
            let _guard = control.gate.lock().await;
        }
    }

    async fn service_loop(&self, spec: ServiceSpec, control: Arc<ServiceRunControl>) {
        if let Some(delay) = spec.startup_delay_ms.filter(|delay| *delay > 0) {
            if wait_or_cancel(&control, delay).await {
                return;
            }
        }
        loop {
            let Some(status) = self
                .run_service_with_control(&spec.name, Arc::clone(&control))
                .await
            else {
                return;
            };
            let Some(delay) = self.next_service_delay(&spec, &status).await else {
                return;
            };
            self.record_service_schedule(&spec.name, delay).await;
            if wait_or_cancel(&control, delay).await {
                return;
            }
        }
    }
}
