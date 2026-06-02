use serde::Deserialize;
use serde_json::Value;
use snapdragon_gateway_core::{
    ActorId, GatewayAgentRuntimeDescriptor, GatewayEnvelope, GatewayJobSpec, GatewaySandboxSpec,
    ReceiveFilter, ServiceSpec, TableAccess,
};

#[derive(Debug, Deserialize)]
pub(crate) struct ServiceSpecParams {
    pub(crate) spec: ServiceSpec,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ServiceNameParams {
    pub(crate) name: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ServiceEnableParams {
    pub(crate) name: String,
    pub(crate) enabled: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ServiceRunParams {
    pub(crate) name: String,
    pub(crate) at_ms: u64,
    pub(crate) summary: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ServiceErrorParams {
    pub(crate) name: String,
    pub(crate) error: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct EnvelopeParams {
    pub(crate) envelope: GatewayEnvelope,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ReceiveParams {
    pub(crate) actor: ActorId,
    #[serde(default)]
    pub(crate) filter: ReceiveFilter,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CapabilityParams {
    pub(crate) capability: String,
    pub(crate) actor: ActorId,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CapabilityLookupParams {
    pub(crate) capability: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AgentRuntimeParams {
    pub(crate) descriptor: GatewayAgentRuntimeDescriptor,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AgentRuntimeIdParams {
    pub(crate) id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TableCreateParams {
    pub(crate) name: String,
    pub(crate) owner: ActorId,
    pub(crate) access: TableAccess,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TableNameParams {
    pub(crate) name: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct JobSpecParams {
    pub(crate) id: Option<String>,
    pub(crate) spec: GatewayJobSpec,
}

#[derive(Debug, Deserialize)]
pub(crate) struct JobIdParams {
    pub(crate) id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct JobAcquireParams {
    pub(crate) queue: Option<String>,
    pub(crate) worker: String,
    pub(crate) lease_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct JobCompleteParams {
    pub(crate) id: String,
    pub(crate) result: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct JobFailParams {
    pub(crate) id: String,
    pub(crate) error: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct EventRecordParams {
    pub(crate) id: Option<String>,
    pub(crate) kind: String,
    pub(crate) target: Option<String>,
    #[serde(default)]
    pub(crate) payload: Value,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LogTailParams {
    pub(crate) target: Option<String>,
    pub(crate) limit: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LogAppendParams {
    pub(crate) at_ms: u64,
    pub(crate) level: Option<String>,
    pub(crate) target: Option<String>,
    pub(crate) message: String,
    pub(crate) data: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SandboxLeaseParams {
    pub(crate) spec: GatewaySandboxSpec,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SandboxIdParams {
    pub(crate) id: String,
}
