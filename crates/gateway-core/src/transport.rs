use serde::{Deserialize, Serialize};

use crate::GatewayEnvelope;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerIdentity {
    pub id: String,
    pub public_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RemoteEnvelope {
    pub from: PeerIdentity,
    pub to: PeerIdentity,
    pub envelope: GatewayEnvelope,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerRegistryEntry {
    pub identity: PeerIdentity,
    pub labels: Vec<String>,
    pub last_seen_ms: Option<u64>,
}

pub trait PeerRegistry {
    fn peers(&self) -> Vec<PeerRegistryEntry>;
    fn resolve(&self, id: &str) -> Option<PeerIdentity>;
}

pub trait GatewayTransport {
    fn local_peer(&self) -> PeerIdentity;
    fn send(&mut self, envelope: RemoteEnvelope) -> Result<(), String>;
}
