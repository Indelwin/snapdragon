use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewayAgentRuntimeKind {
    Sd,
    Codex,
    Hermes,
    Pi,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewayAgentRuntimeProtocol {
    Embedded,
    Command,
    Jsonl,
    Http,
    Stdio,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewayAgentRuntimeIsolation {
    Inherit,
    Profile,
    Channel,
    Sandbox,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewayAgentRuntimeCommand {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewayAgentRuntimeHealth {
    pub state: String,
    pub checked_at_ms: u64,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayAgentRuntimeDescriptor {
    pub id: String,
    pub kind: GatewayAgentRuntimeKind,
    pub protocol: GatewayAgentRuntimeProtocol,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub command: Option<GatewayAgentRuntimeCommand>,
    #[serde(default)]
    pub supported_job_kinds: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub isolation: Option<GatewayAgentRuntimeIsolation>,
    #[serde(default)]
    pub health: Option<GatewayAgentRuntimeHealth>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

impl GatewayAgentRuntimeDescriptor {
    pub fn validate(&self) -> Result<(), String> {
        crate::agent_validation::validate_agent_runtime_descriptor(self)
    }
}

pub fn validate_agent_runtime_id(id: &str) -> Result<String, String> {
    let id = id.trim();
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return Err("gateway agent runtime id must be non-empty".into());
    };
    if !first.is_ascii_alphanumeric() {
        return Err("gateway agent runtime id must start with a letter or number".into());
    }
    if chars.any(|value| {
        !(value.is_ascii_alphanumeric()
            || value == '.'
            || value == '_'
            || value == '-'
            || value == ':')
    }) {
        return Err(
            "gateway agent runtime id may only contain letters, numbers, '.', '_', '-', or ':'"
                .into(),
        );
    }
    Ok(id.to_string())
}
