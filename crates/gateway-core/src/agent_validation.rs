use crate::{
    GatewayAgentRuntimeDescriptor, GatewayAgentRuntimeProtocol, validate_agent_runtime_id,
};

pub(crate) fn validate_agent_runtime_descriptor(
    descriptor: &GatewayAgentRuntimeDescriptor,
) -> Result<(), String> {
    validate_agent_runtime_id(&descriptor.id)?;
    if requires_command(descriptor.protocol)
        && descriptor
            .command
            .as_ref()
            .map(|command| command.command.trim().is_empty())
            .unwrap_or(true)
    {
        return Err(format!(
            "gateway agent runtime {} protocol {:?} requires command.command",
            descriptor.id, descriptor.protocol
        ));
    }
    for value in &descriptor.supported_job_kinds {
        validate_non_empty_list_value("supported_job_kinds", value)?;
    }
    for value in &descriptor.capabilities {
        validate_non_empty_list_value("capabilities", value)?;
    }
    validate_health(descriptor)
}

fn requires_command(protocol: GatewayAgentRuntimeProtocol) -> bool {
    matches!(
        protocol,
        GatewayAgentRuntimeProtocol::Command
            | GatewayAgentRuntimeProtocol::Jsonl
            | GatewayAgentRuntimeProtocol::Stdio
    )
}

fn validate_non_empty_list_value(field: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!(
            "gateway agent runtime {field} entries must be non-empty"
        ));
    }
    Ok(())
}

fn validate_health(descriptor: &GatewayAgentRuntimeDescriptor) -> Result<(), String> {
    if descriptor
        .health
        .as_ref()
        .map(|health| health.state.trim().is_empty())
        .unwrap_or(false)
    {
        return Err("gateway agent runtime health.state must be non-empty".into());
    }
    Ok(())
}
