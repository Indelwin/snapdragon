use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use tokio::sync::{Mutex, Notify};

#[derive(Default)]
pub(crate) struct ShutdownSignal {
    cancelled: AtomicBool,
    notify: Notify,
}

impl ShutdownSignal {
    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Default)]
pub(crate) struct ServiceRunControl {
    pub(crate) gate: Mutex<()>,
    cancelled: AtomicBool,
    notify: Notify,
}

impl ServiceRunControl {
    pub(crate) fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

pub(crate) async fn wait_or_cancel(control: &ServiceRunControl, delay_ms: u64) -> bool {
    tokio::select! {
        _ = control.cancelled() => true,
        _ = tokio::time::sleep(Duration::from_millis(delay_ms)) => false,
    }
}
