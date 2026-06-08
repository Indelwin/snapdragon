use snapdragon_gateway_core::{
    GatewayWorkerHeartbeat, GatewayWorkerRecord, GatewayWorkerRegistration,
};

use crate::GatewayDaemon;

impl GatewayDaemon {
    pub async fn register_worker(
        &self,
        worker: GatewayWorkerRegistration,
        now_ms: u64,
    ) -> Result<GatewayWorkerRecord, String> {
        self.require_store()?.register_worker(worker, now_ms)
    }

    pub async fn heartbeat_worker(
        &self,
        heartbeat: GatewayWorkerHeartbeat,
        now_ms: u64,
    ) -> Result<Option<GatewayWorkerRecord>, String> {
        self.require_store()?.heartbeat_worker(heartbeat, now_ms)
    }

    pub async fn list_workers(&self) -> Result<Vec<GatewayWorkerRecord>, String> {
        self.require_store()?.list_workers()
    }

    pub async fn worker(&self, id: &str) -> Result<Option<GatewayWorkerRecord>, String> {
        self.require_store()?.worker(id)
    }
}
