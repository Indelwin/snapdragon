use snapdragon_gateway_core::{
    GatewayAgentRuntimeDescriptor, GatewayAgentRuntimeKind, GatewayAgentRuntimeProtocol,
    Supervisor, SupervisorStrategy,
};
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

#[tokio::test]
async fn daemon_tracks_agent_runtime_descriptors() {
    let daemon = GatewayDaemon::new();
    daemon
        .register_agent_runtime(GatewayAgentRuntimeDescriptor {
            id: "sd".into(),
            kind: GatewayAgentRuntimeKind::Sd,
            protocol: GatewayAgentRuntimeProtocol::Embedded,
            label: None,
            command: None,
            supported_job_kinds: vec!["agent.run".into()],
            capabilities: vec!["tools.shell".into()],
            isolation: None,
            health: None,
            metadata: None,
        })
        .await;
    assert_eq!(daemon.agent_runtime("sd").await.unwrap().id, "sd");
    assert_eq!(daemon.status().await.agent_runtimes.len(), 1);
}
