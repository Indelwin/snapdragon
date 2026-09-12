use snapdragon_gateway_core::ServiceState;

use crate::GatewayDaemon;

impl GatewayDaemon {
    pub(crate) async fn recover_store(&self) -> Result<(), String> {
        let Some(store) = &self.store else {
            return Ok(());
        };
        {
            let mut inner = self.inner.write().await;
            for descriptor in store.agent_runtime_snapshots()? {
                inner
                    .agent_runtimes
                    .insert(descriptor.id.clone(), descriptor);
            }
        }
        for (spec, mut status) in store.service_snapshots()? {
            let lifecycle = self.service_lifecycle_gate(&spec.name).await;
            let _lifecycle_guard = lifecycle.lock().await;
            status.state = if spec.enabled {
                ServiceState::Running
            } else {
                ServiceState::Stopped
            };
            {
                let mut inner = self.inner.write().await;
                inner.service_specs.insert(spec.name.clone(), spec.clone());
                inner.services.insert(spec.name.clone(), status);
            }
            self.replace_service_task_locked(spec).await;
        }
        let now_ms = crate::unix_time_ms();
        store.expire_leases(now_ms)?;
        store.expire_sandbox_leases(now_ms)?;
        Ok(())
    }
}
