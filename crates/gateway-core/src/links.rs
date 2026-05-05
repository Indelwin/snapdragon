use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::{ActorId, GatewayExitReason};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct MonitorRef(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonitorDown {
    pub reference: MonitorRef,
    pub watcher: ActorId,
    pub watched: ActorId,
    pub reason: GatewayExitReason,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LinkGraph {
    links: BTreeMap<ActorId, BTreeSet<ActorId>>,
    monitors: BTreeMap<MonitorRef, (ActorId, ActorId)>,
}

impl LinkGraph {
    pub fn link(&mut self, left: ActorId, right: ActorId) {
        self.links
            .entry(left.clone())
            .or_default()
            .insert(right.clone());
        self.links.entry(right).or_default().insert(left);
    }

    pub fn monitor(&mut self, reference: MonitorRef, watcher: ActorId, watched: ActorId) {
        self.monitors.insert(reference, (watcher, watched));
    }

    pub fn exit_effects(
        &mut self,
        actor: &ActorId,
        reason: GatewayExitReason,
    ) -> (Vec<ActorId>, Vec<MonitorDown>) {
        let linked = self
            .links
            .remove(actor)
            .map(|linked| {
                for peer in &linked {
                    if let Some(peers) = self.links.get_mut(peer) {
                        peers.remove(actor);
                    }
                }
                linked.into_iter().collect()
            })
            .unwrap_or_default();

        let mut downs = Vec::new();
        let mut remove = Vec::new();
        for (reference, (watcher, watched)) in &self.monitors {
            if watched == actor {
                downs.push(MonitorDown {
                    reference: reference.clone(),
                    watcher: watcher.clone(),
                    watched: watched.clone(),
                    reason: reason.clone(),
                });
                remove.push(reference.clone());
            }
        }
        for reference in remove {
            self.monitors.remove(&reference);
        }
        (linked, downs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_cascade_but_monitors_only_report() {
        let mut graph = LinkGraph::default();
        let a = ActorId::new("a");
        let b = ActorId::new("b");
        let c = ActorId::new("c");
        graph.link(a.clone(), b.clone());
        graph.monitor(MonitorRef("m1".into()), c.clone(), a.clone());
        let (linked, downs) = graph.exit_effects(&a, GatewayExitReason::Error("boom".into()));
        assert_eq!(linked, vec![b]);
        assert_eq!(downs.len(), 1);
        assert_eq!(downs[0].watcher, c);
    }
}
