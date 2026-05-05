use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

use crate::{GatewayEnvelope, ReceiveFilter};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Mailbox {
    queue: VecDeque<GatewayEnvelope>,
}

impl Mailbox {
    pub fn push(&mut self, envelope: GatewayEnvelope) {
        self.queue.push_back(envelope);
    }

    pub fn pop(&mut self) -> Option<GatewayEnvelope> {
        self.queue.pop_front()
    }

    pub fn selective_receive(&mut self, filter: &ReceiveFilter) -> Option<GatewayEnvelope> {
        let index = self
            .queue
            .iter()
            .position(|envelope| filter.matches(envelope))?;
        self.queue.remove(index)
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &GatewayEnvelope> {
        self.queue.iter()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::ActorId;

    fn env(id: u64, kind: &str) -> GatewayEnvelope {
        GatewayEnvelope::new(id, kind, ActorId::new("target"), json!({}), id)
    }

    #[test]
    fn mailbox_preserves_order_for_plain_pop() {
        let mut mailbox = Mailbox::default();
        mailbox.push(env(1, "a"));
        mailbox.push(env(2, "b"));
        assert_eq!(mailbox.pop().map(|e| e.id), Some(1));
        assert_eq!(mailbox.pop().map(|e| e.id), Some(2));
    }

    #[test]
    fn selective_receive_removes_first_matching_message_only() {
        let mut mailbox = Mailbox::default();
        mailbox.push(env(1, "a"));
        mailbox.push(env(2, "b"));
        mailbox.push(env(3, "b"));
        let got = mailbox.selective_receive(&ReceiveFilter {
            kind: Some("b".into()),
            ..ReceiveFilter::default()
        });
        assert_eq!(got.map(|e| e.id), Some(2));
        assert_eq!(mailbox.iter().map(|e| e.id).collect::<Vec<_>>(), vec![1, 3]);
    }
}
