use snapdragon_gateway_core::{GatewayAgentRuntimeDescriptor, validate_agent_runtime_id};

use crate::{GatewayDaemon, unix_time_ms};

impl GatewayDaemon {
    pub async fn register_agent_runtime(
        &self,
        descriptor: GatewayAgentRuntimeDescriptor,
    ) -> Result<GatewayAgentRuntimeDescriptor, String> {
        descriptor.validate()?;
        if let Some(store) = &self.store {
            store.persist_agent_runtime(&descriptor, unix_time_ms())?;
        }
        self.inner
            .write()
            .await
            .agent_runtimes
            .insert(descriptor.id.clone(), descriptor.clone());
        Ok(descriptor)
    }

    pub async fn agent_runtime(&self, id: &str) -> Option<GatewayAgentRuntimeDescriptor> {
        self.inner.read().await.agent_runtimes.get(id).cloned()
    }

    pub async fn unregister_agent_runtime(
        &self,
        id: &str,
    ) -> Result<Option<GatewayAgentRuntimeDescriptor>, String> {
        let id = validate_agent_runtime_id(id)?;
        let removed = self.inner.write().await.agent_runtimes.remove(&id);
        let persisted = self
            .store
            .as_ref()
            .map(|store| store.remove_agent_runtime(&id))
            .transpose()?
            .flatten();
        Ok(removed.or(persisted))
    }

    pub async fn list_agent_runtimes(&self) -> Vec<GatewayAgentRuntimeDescriptor> {
        self.inner
            .read()
            .await
            .agent_runtimes
            .values()
            .cloned()
            .collect()
    }
}
