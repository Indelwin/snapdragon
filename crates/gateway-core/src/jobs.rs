use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GatewayJobState {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayJobSpec {
    pub kind: String,
    pub queue: String,
    pub payload: Value,
    pub priority: i64,
    pub max_attempts: u32,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayJobStatus {
    pub id: String,
    pub spec: GatewayJobSpec,
    pub state: GatewayJobState,
    pub attempts: u32,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub lease_id: Option<String>,
    pub lease_expires_at_ms: Option<u64>,
    pub last_error: Option<String>,
    pub result: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewayLease {
    pub id: String,
    pub job_id: String,
    pub worker: String,
    pub acquired_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GatewayEventState {
    Pending,
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayEventRecord {
    pub id: String,
    pub kind: String,
    pub target: Option<String>,
    pub state: GatewayEventState,
    pub payload: Value,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayLogRecord {
    pub id: u64,
    pub at_ms: u64,
    pub level: String,
    pub target: Option<String>,
    pub message: String,
    pub data: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewayQueueDepth {
    pub queue: String,
    pub pending: u64,
    pub running: u64,
}
