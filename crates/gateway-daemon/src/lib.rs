use std::collections::BTreeMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use snapdragon_gateway_core::{
    ActorId, GatewayEnvelope, GatewayExitReason, LinkGraph, Mailbox, ProcessRegistry,
    ReceiveFilter, RegistrySnapshot, ServiceSpec, ServiceStatus, Supervisor, TableAccess,
    TableRegistry, TableSnapshot,
};
use tokio::{sync::RwLock, task::JoinHandle};

pub mod ipc;
mod service_tasks;
mod service_worker;
mod services;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GatewayStatusSnapshot {
    pub services: Vec<ServiceStatus>,
    pub processes: usize,
    pub tables: Vec<String>,
}

#[derive(Default)]
struct GatewayDaemonInner {
    registry: ProcessRegistry,
    links: LinkGraph,
    mailboxes: BTreeMap<ActorId, Mailbox>,
    tables: TableRegistry,
    service_specs: BTreeMap<String, ServiceSpec>,
    services: BTreeMap<String, ServiceStatus>,
    supervisors: BTreeMap<String, Supervisor>,
}

#[derive(Clone, Default)]
pub struct GatewayDaemon {
    inner: Arc<RwLock<GatewayDaemonInner>>,
    service_tasks: Arc<RwLock<BTreeMap<String, JoinHandle<()>>>>,
}

impl GatewayDaemon {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register_process(&self, name: impl Into<String>, actor: ActorId) {
        self.inner.write().await.registry.register_name(name, actor);
    }

    pub async fn register_capability(&self, capability: impl Into<String>, actor: ActorId) {
        self.inner
            .write()
            .await
            .registry
            .register_capability(capability, actor);
    }

    pub async fn capability_providers(&self, capability: &str) -> Vec<ActorId> {
        self.inner.read().await.registry.providers(capability)
    }

    pub async fn registry_snapshot(&self) -> RegistrySnapshot {
        self.inner.read().await.registry.snapshot()
    }

    pub async fn send(&self, envelope: GatewayEnvelope) {
        self.inner
            .write()
            .await
            .mailboxes
            .entry(envelope.target.clone())
            .or_default()
            .push(envelope);
    }

    pub async fn receive(
        &self,
        actor: &ActorId,
        filter: &ReceiveFilter,
    ) -> Option<GatewayEnvelope> {
        self.inner
            .write()
            .await
            .mailboxes
            .get_mut(actor)
            .and_then(|mailbox| mailbox.selective_receive(filter))
    }

    pub async fn create_table(
        &self,
        name: impl Into<String>,
        owner: ActorId,
        access: TableAccess,
    ) -> bool {
        self.inner.write().await.tables.create(name, owner, access)
    }

    pub async fn table_names(&self) -> Vec<String> {
        self.inner.read().await.tables.table_names()
    }

    pub async fn table_snapshot(&self, name: &str) -> Option<TableSnapshot> {
        self.inner.read().await.tables.snapshot(name)
    }

    pub async fn exit_process(&self, actor: &ActorId, reason: GatewayExitReason) {
        let mut inner = self.inner.write().await;
        inner.registry.unregister_actor(actor);
        inner.mailboxes.remove(actor);
        inner.tables.cleanup_owner(actor);
        let _ = inner.links.exit_effects(actor, reason);
    }

    pub async fn attach_supervisor(&self, name: impl Into<String>, supervisor: Supervisor) {
        self.inner
            .write()
            .await
            .supervisors
            .insert(name.into(), supervisor);
    }

    pub async fn status(&self) -> GatewayStatusSnapshot {
        let inner = self.inner.read().await;
        GatewayStatusSnapshot {
            services: inner.services.values().cloned().collect(),
            processes: inner.mailboxes.len(),
            tables: inner.tables.table_names(),
        }
    }
}

#[cfg(test)]
mod tests {
    use snapdragon_gateway_core::SupervisorStrategy;

    use super::*;

    #[tokio::test]
    async fn daemon_accepts_supervisor_state() {
        let daemon = GatewayDaemon::new();
        daemon
            .attach_supervisor(
                "root",
                Supervisor::new(SupervisorStrategy::OneForOne, 3, 1_000),
            )
            .await;
        assert!(daemon.status().await.services.is_empty());
    }
}
