use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewayProjectRef {
    pub id: String,
    pub root: String,
    #[serde(default)]
    pub branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewaySandboxLease {
    pub id: String,
    pub sandbox_id: String,
    pub cwd: String,
    pub acquired_at_ms: u64,
    #[serde(default)]
    pub expires_at_ms: Option<u64>,
    #[serde(default)]
    pub backend: Option<GatewaySandboxBackend>,
    #[serde(default)]
    pub project: Option<GatewayProjectRef>,
    #[serde(default)]
    pub reference_roots: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewaySandboxBackend {
    Worktree,
}
