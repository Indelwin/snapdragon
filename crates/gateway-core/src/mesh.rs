use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ActorId, GatewayEnvelope, ProcessRegistry};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityCall {
    pub capability: String,
    pub payload: Value,
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum MeshRoute {
    Local(GatewayEnvelope),
    MissingCapability(String),
}

pub fn route_capability_call(
    registry: &ProcessRegistry,
    call: CapabilityCall,
    source: Option<ActorId>,
    id: u64,
    now_ms: u64,
) -> MeshRoute {
    let Some(target) = registry.providers(&call.capability).into_iter().next() else {
        return MeshRoute::MissingCapability(call.capability);
    };
    let mut envelope = GatewayEnvelope::new(id, "capability.call", target, call.payload, now_ms);
    envelope.source = source;
    envelope.correlation_id = call.correlation_id;
    envelope.capability = Some(call.capability);
    MeshRoute::Local(envelope)
}
