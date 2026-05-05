use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GatewayRuntimeKind {
    Rust,
    InlineTs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ServiceState {
    Starting,
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceBudget {
    pub max_fuel: Option<u64>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceWorkerSpec {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceSpec {
    pub name: String,
    pub enabled: bool,
    pub interval_ms: Option<u64>,
    pub startup_delay_ms: Option<u64>,
    pub budget: Option<ServiceBudget>,
    pub worker: Option<ServiceWorkerSpec>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub name: String,
    pub enabled: bool,
    pub state: ServiceState,
    pub runs: u64,
    pub errors: u64,
    pub last_run_at_ms: Option<u64>,
    pub last_error: Option<String>,
    pub last_summary: Option<String>,
}
