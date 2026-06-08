use std::collections::BTreeMap;
use std::sync::Arc;

use snapdragon_gateway_core::{
    ActorId, GatewayAgentRuntimeDescriptor, GatewayEnvelope, GatewayExitReason, GatewayJobSpec,
    GatewayJobStatus, GatewayLogRecord, GatewayWorkerProcess, LinkGraph, Mailbox, ProcessRegistry,
    ReceiveFilter, RegistrySnapshot, ServiceSpec, ServiceStatus, Supervisor, TableAccess,
    TableRegistry, TableSnapshot,
};
use tokio::{sync::RwLock, task::JoinHandle};

mod agent_runtimes;
pub mod ipc;
mod ipc_core;
mod ipc_durable;
mod ipc_params;
mod process_tracking;
mod sandboxes;
mod service_supervision;
mod service_tasks;
mod service_worker;
mod services;
mod services_persistence;
mod status;
mod store;
mod store_agent_runtimes;
mod store_events;
mod store_job_types;
mod store_jobs;
mod store_leases;
mod store_observability;
mod store_sandboxes;
mod store_schema;
mod store_services;
mod store_workers;
mod workers;

pub use status::GatewayStatusSnapshot;
pub use store::GatewayStore;

#[derive(Default)]
struct GatewayDaemonInner {
    registry: ProcessRegistry,
    links: LinkGraph,
    mailboxes: BTreeMap<ActorId, Mailbox>,
    tables: TableRegistry,
    agent_runtimes: BTreeMap<String, GatewayAgentRuntimeDescriptor>,
    service_specs: BTreeMap<String, ServiceSpec>,
    services: BTreeMap<String, ServiceStatus>,
    worker_processes: BTreeMap<String, GatewayWorkerProcess>,
    service_restart_windows: BTreeMap<String, Vec<u64>>,
    supervisors: BTreeMap<String, Supervisor>,
}

#[derive(Clone, Default)]
pub struct GatewayDaemon {
    inner: Arc<RwLock<GatewayDaemonInner>>,
    service_tasks: Arc<RwLock<BTreeMap<String, JoinHandle<()>>>>,
    store: Option<GatewayStore>,
    started_at_ms: u64,
}

impl GatewayDaemon {
    pub fn new() -> Self {
        Self {
            started_at_ms: unix_time_ms(),
            ..Self::default()
        }
    }

    pub async fn with_store(store: GatewayStore) -> Result<Self, String> {
        let daemon = Self {
            store: Some(store),
            started_at_ms: unix_time_ms(),
            ..Self::default()
        };
        daemon.recover_store().await?;
        Ok(daemon)
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

    pub fn store(&self) -> Option<&GatewayStore> {
        self.store.as_ref()
    }

    pub async fn enqueue_job(
        &self,
        id: String,
        spec: GatewayJobSpec,
        now_ms: u64,
    ) -> Result<GatewayJobStatus, String> {
        let store = self.require_store()?;
        store.enqueue_job(id, spec, now_ms)
    }

    pub async fn list_jobs(&self) -> Result<Vec<GatewayJobStatus>, String> {
        self.require_store()?.list_jobs()
    }

    pub async fn job(&self, id: &str) -> Result<Option<GatewayJobStatus>, String> {
        self.require_store()?.job(id)
    }

    pub async fn cancel_job(
        &self,
        id: &str,
        now_ms: u64,
    ) -> Result<Option<GatewayJobStatus>, String> {
        self.require_store()?.cancel_job(id, now_ms)
    }

    pub async fn tail_logs(
        &self,
        target: Option<&str>,
        limit: u64,
    ) -> Result<Vec<GatewayLogRecord>, String> {
        self.require_store()?.tail_logs(target, limit)
    }

    pub async fn attach_supervisor(&self, name: impl Into<String>, supervisor: Supervisor) {
        self.inner
            .write()
            .await
            .supervisors
            .insert(name.into(), supervisor);
    }

    pub async fn run_watchdogs(&self) -> Result<u64, String> {
        let now_ms = unix_time_ms();
        let store = self.require_store()?;
        let expired_jobs = store.expire_leases(now_ms)?;
        let expired_sandboxes = store.expire_sandbox_leases(now_ms)?;
        Ok(expired_jobs + expired_sandboxes)
    }

    async fn recover_store(&self) -> Result<(), String> {
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
            status.state = if spec.enabled {
                snapdragon_gateway_core::ServiceState::Running
            } else {
                snapdragon_gateway_core::ServiceState::Stopped
            };
            {
                let mut inner = self.inner.write().await;
                inner.service_specs.insert(spec.name.clone(), spec.clone());
                inner.services.insert(spec.name.clone(), status);
            }
            self.replace_service_task(spec).await;
        }
        let now_ms = unix_time_ms();
        store.expire_leases(now_ms)?;
        store.expire_sandbox_leases(now_ms)?;
        Ok(())
    }

    pub(crate) fn require_store(&self) -> Result<&GatewayStore, String> {
        self.store
            .as_ref()
            .ok_or_else(|| "gateway durable store is not configured".to_string())
    }
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
