use std::collections::VecDeque;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::{GatewayEnvelope, ReceiveFilter};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MailboxLimits {
    pub max_messages: usize,
    pub max_bytes: usize,
    pub max_message_bytes: usize,
}

impl Default for MailboxLimits {
    fn default() -> Self {
        Self {
            max_messages: 1_024,
            max_bytes: 8 * 1024 * 1024,
            max_message_bytes: 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MailboxPushError {
    Oversized {
        bytes: usize,
        max_bytes: usize,
    },
    Busy {
        messages: usize,
        bytes: usize,
        max_messages: usize,
        max_bytes: usize,
    },
}

impl fmt::Display for MailboxPushError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Oversized { bytes, max_bytes } => {
                write!(
                    formatter,
                    "mailbox message oversized: {bytes} bytes exceeds {max_bytes}"
                )
            }
            Self::Busy {
                messages,
                bytes,
                max_messages,
                max_bytes,
            } => write!(
                formatter,
                "mailbox busy: {messages}/{max_messages} messages and {bytes}/{max_bytes} bytes",
            ),
        }
    }
}

impl std::error::Error for MailboxPushError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mailbox {
    queue: VecDeque<GatewayEnvelope>,
    #[serde(default)]
    bytes: usize,
    #[serde(default)]
    limits: MailboxLimits,
}

impl Default for Mailbox {
    fn default() -> Self {
        Self::with_limits(MailboxLimits::default())
    }
}

impl Mailbox {
    pub fn with_limits(limits: MailboxLimits) -> Self {
        Self {
            queue: VecDeque::new(),
            bytes: 0,
            limits,
        }
    }

    pub fn push(&mut self, envelope: GatewayEnvelope) -> Result<(), MailboxPushError> {
        let bytes = envelope_bytes(&envelope);
        if bytes > self.limits.max_message_bytes {
            return Err(MailboxPushError::Oversized {
                bytes,
                max_bytes: self.limits.max_message_bytes,
            });
        }
        if self.queue.len() >= self.limits.max_messages
            || self.bytes.saturating_add(bytes) > self.limits.max_bytes
        {
            return Err(MailboxPushError::Busy {
                messages: self.queue.len(),
                bytes: self.bytes,
                max_messages: self.limits.max_messages,
                max_bytes: self.limits.max_bytes,
            });
        }
        self.bytes = self.bytes.saturating_add(bytes);
        self.queue.push_back(envelope);
        Ok(())
    }

    pub fn pop(&mut self) -> Option<GatewayEnvelope> {
        let envelope = self.queue.pop_front()?;
        self.bytes = self.bytes.saturating_sub(envelope_bytes(&envelope));
        Some(envelope)
    }

    pub fn selective_receive(&mut self, filter: &ReceiveFilter) -> Option<GatewayEnvelope> {
        let index = self
            .queue
            .iter()
            .position(|envelope| filter.matches(envelope))?;
        let envelope = self.queue.remove(index)?;
        self.bytes = self.bytes.saturating_sub(envelope_bytes(&envelope));
        Some(envelope)
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

    pub fn bytes(&self) -> usize {
        self.bytes
    }
}

fn envelope_bytes(envelope: &GatewayEnvelope) -> usize {
    serde_json::to_vec(envelope)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
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
        mailbox.push(env(1, "a")).unwrap();
        mailbox.push(env(2, "b")).unwrap();
        assert_eq!(mailbox.pop().map(|e| e.id), Some(1));
        assert_eq!(mailbox.pop().map(|e| e.id), Some(2));
    }

    #[test]
    fn selective_receive_removes_first_matching_message_only() {
        let mut mailbox = Mailbox::default();
        mailbox.push(env(1, "a")).unwrap();
        mailbox.push(env(2, "b")).unwrap();
        mailbox.push(env(3, "b")).unwrap();
        let got = mailbox.selective_receive(&ReceiveFilter {
            kind: Some("b".into()),
            ..ReceiveFilter::default()
        });
        assert_eq!(got.map(|e| e.id), Some(2));
        assert_eq!(mailbox.iter().map(|e| e.id).collect::<Vec<_>>(), vec![1, 3]);
    }

    #[test]
    fn mailbox_rejects_oversized_and_busy_messages_explicitly() {
        let mut mailbox = Mailbox::with_limits(MailboxLimits {
            max_messages: 1,
            max_bytes: 1_000,
            max_message_bytes: 200,
        });
        mailbox.push(env(1, "a")).unwrap();
        assert!(matches!(
            mailbox.push(env(2, "b")),
            Err(MailboxPushError::Busy { .. })
        ));
        mailbox.pop();
        let mut oversized = env(3, "c");
        oversized.payload = json!({ "value": "x".repeat(500) });
        assert!(matches!(
            mailbox.push(oversized),
            Err(MailboxPushError::Oversized { .. })
        ));
    }
}
