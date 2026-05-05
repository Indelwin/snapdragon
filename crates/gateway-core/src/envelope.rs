use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ActorId(pub String);

impl ActorId {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GatewayExitReason {
    Normal,
    Shutdown,
    Killed,
    Error(String),
    BudgetExceeded,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayEnvelope {
    pub id: u64,
    pub kind: String,
    pub source: Option<ActorId>,
    pub target: ActorId,
    pub correlation_id: Option<String>,
    pub capability: Option<String>,
    pub payload: Value,
    pub inserted_at_ms: u64,
}

impl GatewayEnvelope {
    pub fn new(
        id: u64,
        kind: impl Into<String>,
        target: ActorId,
        payload: Value,
        inserted_at_ms: u64,
    ) -> Self {
        Self {
            id,
            kind: kind.into(),
            source: None,
            target,
            correlation_id: None,
            capability: None,
            payload,
            inserted_at_ms,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiveFilter {
    pub kind: Option<String>,
    pub source: Option<ActorId>,
    pub correlation_id: Option<String>,
    pub capability: Option<String>,
}

impl ReceiveFilter {
    pub fn matches(&self, envelope: &GatewayEnvelope) -> bool {
        if self.kind.as_ref().is_some_and(|v| v != &envelope.kind) {
            return false;
        }
        if self
            .source
            .as_ref()
            .is_some_and(|v| envelope.source.as_ref() != Some(v))
        {
            return false;
        }
        if self
            .correlation_id
            .as_ref()
            .is_some_and(|v| envelope.correlation_id.as_ref() != Some(v))
        {
            return false;
        }
        if self
            .capability
            .as_ref()
            .is_some_and(|v| envelope.capability.as_ref() != Some(v))
        {
            return false;
        }
        true
    }
}
