use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewayWorkerState {
    Idle,
    Running,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayWorkerRegistration {
    pub id: String,
    #[serde(default)]
    pub queue: Option<String>,
    #[serde(default)]
    pub runtime_id: Option<String>,
    #[serde(default)]
    pub service: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayWorkerHeartbeat {
    pub id: String,
    #[serde(default)]
    pub state: Option<GatewayWorkerState>,
    #[serde(default)]
    pub queue: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayWorkerRecord {
    pub id: String,
    pub queue: String,
    #[serde(default)]
    pub runtime_id: Option<String>,
    #[serde(default)]
    pub service: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub state: GatewayWorkerState,
    pub registered_at_ms: u64,
    pub heartbeat_at_ms: u64,
    #[serde(default)]
    pub current_job_id: Option<String>,
    #[serde(default)]
    pub current_lease_id: Option<String>,
    #[serde(default)]
    pub lease_expires_at_ms: Option<u64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub metadata: Option<Value>,
}

impl GatewayWorkerRegistration {
    pub fn into_record(self, now_ms: u64) -> Result<GatewayWorkerRecord, String> {
        let id = validate_worker_id(&self.id)?;
        Ok(GatewayWorkerRecord {
            id,
            queue: validate_worker_field("queue", self.queue.as_deref().unwrap_or("default"))?,
            runtime_id: optional_non_empty("runtime_id", self.runtime_id)?,
            service: optional_non_empty("service", self.service)?,
            capabilities: validate_capabilities(self.capabilities)?,
            state: GatewayWorkerState::Idle,
            registered_at_ms: now_ms,
            heartbeat_at_ms: now_ms,
            current_job_id: None,
            current_lease_id: None,
            lease_expires_at_ms: None,
            status: optional_non_empty("status", self.status)?,
            last_error: None,
            metadata: self.metadata,
        })
    }
}

pub fn validate_worker_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("gateway worker id must be non-empty".into());
    }
    if value.len() > 128 {
        return Err("gateway worker id must be 128 characters or fewer".into());
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ':'))
    {
        return Err(
            "gateway worker id must contain only letters, numbers, '.', '_', '-', or ':'".into(),
        );
    }
    Ok(value.to_string())
}

fn validate_capabilities(values: Vec<String>) -> Result<Vec<String>, String> {
    values
        .into_iter()
        .map(|value| validate_worker_field("capability", &value))
        .collect()
}

fn optional_non_empty(field: &str, value: Option<String>) -> Result<Option<String>, String> {
    value
        .map(|value| validate_worker_field(field, &value))
        .transpose()
}

fn validate_worker_field(field: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("gateway worker {field} must be non-empty"));
    }
    Ok(value.to_string())
}
