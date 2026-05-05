use std::collections::{BTreeMap, VecDeque};

use serde::{Deserialize, Serialize};

use crate::{ActorId, GatewayExitReason};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SupervisorStrategy {
    OneForOne,
    OneForAll,
    RestForOne,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChildRestart {
    Permanent,
    Transient,
    Temporary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChildSpec {
    pub id: String,
    pub actor: ActorId,
    pub restart: ChildRestart,
    pub backoff_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SupervisorAction {
    Restart { child_id: String, after_ms: u64 },
    Stop { child_id: String },
    Shutdown { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Supervisor {
    pub strategy: SupervisorStrategy,
    pub max_restarts: usize,
    pub within_ms: u64,
    children: Vec<ChildSpec>,
    restart_log: VecDeque<u64>,
}

impl Supervisor {
    pub fn new(strategy: SupervisorStrategy, max_restarts: usize, within_ms: u64) -> Self {
        Self {
            strategy,
            max_restarts,
            within_ms,
            children: Vec::new(),
            restart_log: VecDeque::new(),
        }
    }

    pub fn add_child(&mut self, spec: ChildSpec) {
        self.children.push(spec);
    }

    pub fn child_by_actor(&self, actor: &ActorId) -> Option<&ChildSpec> {
        self.children.iter().find(|child| &child.actor == actor)
    }

    pub fn handle_exit(
        &mut self,
        actor: &ActorId,
        reason: GatewayExitReason,
        at_ms: u64,
    ) -> Vec<SupervisorAction> {
        let Some(index) = self.children.iter().position(|child| &child.actor == actor) else {
            return Vec::new();
        };
        if !should_restart(self.children[index].restart, &reason) {
            return vec![SupervisorAction::Stop {
                child_id: self.children[index].id.clone(),
            }];
        }
        if !self.record_restart_allowed(at_ms) {
            return vec![SupervisorAction::Shutdown {
                reason: "restart intensity exceeded".into(),
            }];
        }
        self.restart_actions(index)
    }

    pub fn children(&self) -> &[ChildSpec] {
        &self.children
    }

    fn restart_actions(&self, failed_index: usize) -> Vec<SupervisorAction> {
        let indices: Vec<usize> = match self.strategy {
            SupervisorStrategy::OneForOne => vec![failed_index],
            SupervisorStrategy::OneForAll => (0..self.children.len()).collect(),
            SupervisorStrategy::RestForOne => (failed_index..self.children.len()).collect(),
        };
        indices
            .into_iter()
            .map(|index| {
                let child = &self.children[index];
                SupervisorAction::Restart {
                    child_id: child.id.clone(),
                    after_ms: child.backoff_ms,
                }
            })
            .collect()
    }

    fn record_restart_allowed(&mut self, at_ms: u64) -> bool {
        while self
            .restart_log
            .front()
            .is_some_and(|old| at_ms.saturating_sub(*old) > self.within_ms)
        {
            self.restart_log.pop_front();
        }
        self.restart_log.push_back(at_ms);
        self.restart_log.len() <= self.max_restarts
    }
}

pub fn child_index_by_id(children: &[ChildSpec]) -> BTreeMap<String, usize> {
    children
        .iter()
        .enumerate()
        .map(|(index, child)| (child.id.clone(), index))
        .collect()
}

fn should_restart(kind: ChildRestart, reason: &GatewayExitReason) -> bool {
    match kind {
        ChildRestart::Permanent => true,
        ChildRestart::Transient => !matches!(reason, GatewayExitReason::Normal),
        ChildRestart::Temporary => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(id: &str) -> ChildSpec {
        ChildSpec {
            id: id.into(),
            actor: ActorId::new(id),
            restart: ChildRestart::Permanent,
            backoff_ms: 10,
        }
    }

    #[test]
    fn rest_for_one_restarts_failed_child_and_later_children() {
        let mut supervisor = Supervisor::new(SupervisorStrategy::RestForOne, 3, 1_000);
        supervisor.add_child(spec("a"));
        supervisor.add_child(spec("b"));
        supervisor.add_child(spec("c"));
        let actions = supervisor.handle_exit(
            &ActorId::new("b"),
            GatewayExitReason::Error("boom".into()),
            100,
        );
        assert_eq!(
            actions,
            vec![
                SupervisorAction::Restart {
                    child_id: "b".into(),
                    after_ms: 10
                },
                SupervisorAction::Restart {
                    child_id: "c".into(),
                    after_ms: 10
                }
            ]
        );
    }

    #[test]
    fn restart_intensity_shuts_supervisor_down() {
        let mut supervisor = Supervisor::new(SupervisorStrategy::OneForOne, 1, 1_000);
        supervisor.add_child(spec("a"));
        assert!(matches!(
            supervisor.handle_exit(&ActorId::new("a"), GatewayExitReason::Killed, 100)[0],
            SupervisorAction::Restart { .. }
        ));
        assert_eq!(
            supervisor.handle_exit(&ActorId::new("a"), GatewayExitReason::Killed, 200),
            vec![SupervisorAction::Shutdown {
                reason: "restart intensity exceeded".into()
            }]
        );
    }
}
