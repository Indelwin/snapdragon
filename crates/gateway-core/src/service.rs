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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceRestart {
    Permanent,
    #[default]
    Transient,
    Temporary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceRestartIntensity {
    pub max_restarts: u32,
    pub within_ms: u64,
}

impl Default for ServiceRestartIntensity {
    fn default() -> Self {
        Self {
            max_restarts: 3,
            within_ms: 60_000,
        }
    }
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
    #[serde(default)]
    pub restart: ServiceRestart,
    #[serde(default)]
    pub restart_intensity: ServiceRestartIntensity,
    pub backoff_ms: Option<u64>,
    pub max_backoff_ms: Option<u64>,
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
    #[serde(default)]
    pub consecutive_errors: u64,
    pub last_run_at_ms: Option<u64>,
    pub last_error: Option<String>,
    pub last_summary: Option<String>,
    #[serde(default)]
    pub restart_suppressed: bool,
    #[serde(default)]
    pub next_run_at_ms: Option<u64>,
    #[serde(default)]
    pub last_exit_reason: Option<String>,
}
