use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::ActorId;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RegistrySnapshot {
    pub names: BTreeMap<String, ActorId>,
    pub capabilities: BTreeMap<String, Vec<ActorId>>,
    pub channels: BTreeMap<String, ActorId>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProcessRegistry {
    names: BTreeMap<String, ActorId>,
    capabilities: BTreeMap<String, BTreeSet<ActorId>>,
    actor_capabilities: BTreeMap<ActorId, BTreeSet<String>>,
    channels: BTreeMap<String, ActorId>,
}

impl ProcessRegistry {
    pub fn register_name(&mut self, name: impl Into<String>, actor: ActorId) -> Option<ActorId> {
        self.names.insert(name.into(), actor)
    }

    pub fn whereis(&self, name: &str) -> Option<&ActorId> {
        self.names.get(name)
    }

    pub fn register_channel(
        &mut self,
        target: impl Into<String>,
        actor: ActorId,
    ) -> Option<ActorId> {
        self.channels.insert(target.into(), actor)
    }

    pub fn channel(&self, target: &str) -> Option<&ActorId> {
        self.channels.get(target)
    }

    pub fn register_capability(&mut self, capability: impl Into<String>, actor: ActorId) {
        let capability = capability.into();
        self.capabilities
            .entry(capability.clone())
            .or_default()
            .insert(actor.clone());
        self.actor_capabilities
            .entry(actor)
            .or_default()
            .insert(capability);
    }

    pub fn providers(&self, capability: &str) -> Vec<ActorId> {
        self.capabilities
            .get(capability)
            .map(|actors| actors.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn snapshot(&self) -> RegistrySnapshot {
        RegistrySnapshot {
            names: self.names.clone(),
            capabilities: self
                .capabilities
                .iter()
                .map(|(capability, actors)| (capability.clone(), actors.iter().cloned().collect()))
                .collect(),
            channels: self.channels.clone(),
        }
    }

    pub fn unregister_actor(&mut self, actor: &ActorId) {
        self.names.retain(|_, value| value != actor);
        self.channels.retain(|_, value| value != actor);
        if let Some(capabilities) = self.actor_capabilities.remove(actor) {
            for capability in capabilities {
                if let Some(actors) = self.capabilities.get_mut(&capability) {
                    actors.remove(actor);
                    if actors.is_empty() {
                        self.capabilities.remove(&capability);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_unregister_removes_names_channels_and_capabilities() {
        let mut registry = ProcessRegistry::default();
        let actor = ActorId::new("a");
        registry.register_name("worker", actor.clone());
        registry.register_channel("local:test", actor.clone());
        registry.register_capability("capability.call", actor.clone());
        registry.unregister_actor(&actor);
        assert_eq!(registry.whereis("worker"), None);
        assert_eq!(registry.channel("local:test"), None);
        assert!(registry.providers("capability.call").is_empty());
    }
}
