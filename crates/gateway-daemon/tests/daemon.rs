use snapdragon_gateway_core::{Supervisor, SupervisorStrategy};
use snapdragon_gateway_daemon::GatewayDaemon;

#[tokio::test]
async fn daemon_accepts_supervisor_state() {
    let daemon = GatewayDaemon::new();
    daemon
        .attach_supervisor(
            "root",
            Supervisor::new(SupervisorStrategy::OneForOne, 3, 1_000),
        )
        .await;
    assert!(daemon.status().await.services.is_empty());
}
