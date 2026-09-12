use std::{sync::Arc, time::Duration};

use crate::GatewayDaemon;

const WATCHDOG_INTERVAL: Duration = Duration::from_millis(250);

impl GatewayDaemon {
    pub(crate) async fn start_watchdog(&self) {
        if self.store().is_none() || self.watchdog_task.lock().await.is_some() {
            return;
        }
        let daemon = self.clone();
        let shutdown = Arc::clone(&self.shutdown_signal);
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(WATCHDOG_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _ = shutdown.cancelled() => return,
                    _ = interval.tick() => {
                        let _ = daemon.run_watchdogs().await;
                    }
                }
            }
        });
        *self.watchdog_task.lock().await = Some(task);
    }
}
