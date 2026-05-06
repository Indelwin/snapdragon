use serde_json::Value;
use snapdragon_gateway_core::{GatewayJobSpec, GatewayJobState, GatewayJobStatus};

pub(crate) fn pending_job_status(
    id: String,
    spec: GatewayJobSpec,
    now_ms: u64,
) -> GatewayJobStatus {
    GatewayJobStatus {
        id,
        spec,
        state: GatewayJobState::Pending,
        attempts: 0,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
        lease_id: None,
        lease_expires_at_ms: None,
        last_error: None,
        result: None,
    }
}

pub(crate) fn expired_state(status: &GatewayJobStatus) -> GatewayJobState {
    if status.attempts >= status.spec.max_attempts {
        GatewayJobState::Failed
    } else {
        GatewayJobState::Pending
    }
}

pub(crate) fn job_log_data(status: &GatewayJobStatus) -> Value {
    serde_json::json!({ "kind": status.spec.kind, "queue": status.spec.queue })
}

pub(crate) fn job_state(state: &GatewayJobState) -> &'static str {
    match state {
        GatewayJobState::Pending => "pending",
        GatewayJobState::Running => "running",
        GatewayJobState::Completed => "completed",
        GatewayJobState::Failed => "failed",
        GatewayJobState::Cancelled => "cancelled",
    }
}
