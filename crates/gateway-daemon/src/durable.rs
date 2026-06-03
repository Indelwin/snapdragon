use snapdragon_gateway_core::{
    GatewayJobSpec, GatewayJobStatus, GatewayLogRecord, GatewaySandboxLease, GatewaySandboxSpec,
};

use crate::GatewayDaemon;

impl GatewayDaemon {
    pub async fn enqueue_job(
        &self,
        id: String,
        spec: GatewayJobSpec,
        now_ms: u64,
    ) -> Result<GatewayJobStatus, String> {
        self.require_store()?.enqueue_job(id, spec, now_ms)
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

    pub async fn retry_job(
        &self,
        id: &str,
        now_ms: u64,
    ) -> Result<Option<GatewayJobStatus>, String> {
        self.require_store()?.retry_job(id, now_ms)
    }

    pub async fn tail_logs(
        &self,
        target: Option<&str>,
        limit: u64,
    ) -> Result<Vec<GatewayLogRecord>, String> {
        self.require_store()?.tail_logs(target, limit)
    }

    pub async fn lease_sandbox(
        &self,
        spec: GatewaySandboxSpec,
        now_ms: u64,
    ) -> Result<GatewaySandboxLease, String> {
        self.require_store()?.lease_sandbox(spec, now_ms)
    }

    pub async fn list_sandbox_leases(&self) -> Result<Vec<GatewaySandboxLease>, String> {
        self.require_store()?.sandbox_leases(unix_time_ms())
    }

    pub async fn sandbox_lease(&self, id: &str) -> Result<Option<GatewaySandboxLease>, String> {
        self.require_store()?.sandbox_lease(id, unix_time_ms())
    }

    pub async fn release_sandbox(&self, id: &str) -> Result<Option<GatewaySandboxLease>, String> {
        self.require_store()?.release_sandbox(id, unix_time_ms())
    }

    pub async fn run_watchdogs(&self) -> Result<u64, String> {
        self.require_store()?.expire_leases(unix_time_ms())
    }
}

fn unix_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
