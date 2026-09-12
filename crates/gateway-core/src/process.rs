use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewayWorkerProcessState {
    Running,
    Exited,
    TimedOut,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewayWorkerProcess {
    pub id: String,
    pub service: String,
    pub pid: Option<u32>,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub started_at_ms: u64,
    pub finished_at_ms: Option<u64>,
    pub timeout_ms: Option<u64>,
    pub state: GatewayWorkerProcessState,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub stdout_preview: String,
    #[serde(default)]
    pub stderr_preview: String,
    #[serde(default)]
    pub stdout_log: Option<String>,
    #[serde(default)]
    pub stderr_log: Option<String>,
}
