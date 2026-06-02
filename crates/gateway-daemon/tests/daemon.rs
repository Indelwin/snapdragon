use snapdragon_gateway_core::{
    GatewayAgentRuntimeCommand, GatewayAgentRuntimeDescriptor, GatewayAgentRuntimeKind,
    GatewayAgentRuntimeProtocol, Supervisor, SupervisorStrategy,
};
use snapdragon_gateway_daemon::{GatewayDaemon, GatewayStore};

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
        .await
        .unwrap();
    assert_eq!(daemon.agent_runtime("sd").await.unwrap().id, "sd");
    assert_eq!(daemon.status().await.agent_runtimes.len(), 1);
}

#[tokio::test]
async fn daemon_recovers_agent_runtime_descriptors_from_store() {
    let path = std::env::temp_dir().join(format!(
        "snapdragon-gateway-daemon-runtime-{}.sqlite",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    {
        let daemon = GatewayDaemon::with_store(GatewayStore::open(&path).unwrap())
            .await
            .unwrap();
        daemon
            .register_agent_runtime(GatewayAgentRuntimeDescriptor {
                id: "pi".into(),
                kind: GatewayAgentRuntimeKind::Pi,
                protocol: GatewayAgentRuntimeProtocol::Jsonl,
                label: Some("Pi Agent".into()),
                command: Some(GatewayAgentRuntimeCommand {
                    command: "pi".into(),
                    args: vec!["--mode".into(), "rpc".into()],
                    cwd: None,
                    env: Default::default(),
                }),
                supported_job_kinds: vec!["agent.run".into()],
                capabilities: vec!["skills.pi".into()],
                isolation: None,
                health: None,
                metadata: None,
            })
            .await
            .unwrap();
    }

    let recovered = GatewayDaemon::with_store(GatewayStore::open(&path).unwrap())
        .await
        .unwrap();
    assert_eq!(
        recovered.agent_runtime("pi").await.unwrap().kind,
        GatewayAgentRuntimeKind::Pi
    );
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn daemon_rejects_invalid_agent_runtime_descriptors() {
    let daemon = GatewayDaemon::new();
    let error = daemon
        .register_agent_runtime(GatewayAgentRuntimeDescriptor {
            id: "bad runtime".into(),
            kind: GatewayAgentRuntimeKind::Codex,
            protocol: GatewayAgentRuntimeProtocol::Command,
            label: None,
            command: None,
            supported_job_kinds: vec!["agent.run".into()],
            capabilities: vec![],
            isolation: None,
            health: None,
            metadata: None,
        })
        .await
        .unwrap_err();
    assert!(error.contains("id"));

    let error = daemon
        .register_agent_runtime(GatewayAgentRuntimeDescriptor {
            id: "codex".into(),
            kind: GatewayAgentRuntimeKind::Codex,
            protocol: GatewayAgentRuntimeProtocol::Command,
            label: None,
            command: None,
            supported_job_kinds: vec!["agent.run".into()],
            capabilities: vec![],
            isolation: None,
            health: None,
            metadata: None,
        })
        .await
        .unwrap_err();
    assert!(error.contains("requires command.command"));
}
