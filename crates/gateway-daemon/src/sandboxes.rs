use snapdragon_gateway_core::GatewaySandboxLease;

use crate::GatewayDaemon;

impl GatewayDaemon {
    pub async fn register_sandbox_lease(
        &self,
        lease: GatewaySandboxLease,
        now_ms: u64,
    ) -> Result<GatewaySandboxLease, String> {
        self.require_store()?.register_sandbox_lease(lease, now_ms)
    }

    pub async fn list_sandbox_leases(&self) -> Result<Vec<GatewaySandboxLease>, String> {
        self.require_store()?.list_sandbox_leases()
    }

    pub async fn sandbox_lease(&self, id: &str) -> Result<Option<GatewaySandboxLease>, String> {
        self.require_store()?.sandbox_lease(id)
    }

    pub async fn release_sandbox_lease(
        &self,
        id: &str,
        now_ms: u64,
    ) -> Result<Option<GatewaySandboxLease>, String> {
        self.require_store()?.release_sandbox_lease(id, now_ms)
    }
}
