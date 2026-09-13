use std::time::{SystemTime, UNIX_EPOCH};

use snapdragon_gateway_core::GatewayJobSpec;

pub(crate) fn normalize_job_spec(mut spec: GatewayJobSpec) -> GatewayJobSpec {
    if spec.queue.is_empty() {
        spec.queue = "default".into();
    }
    if spec.max_attempts == 0 {
        spec.max_attempts = 1;
    }
    spec
}

pub(crate) fn generated_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{prefix}_{nanos}")
}

pub(crate) fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
