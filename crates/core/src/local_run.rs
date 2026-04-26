use alloc::string::String;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::bundle::Bundle;
use crate::component::{Entity, Identity};
use crate::error::RunError;
use crate::host::HostPipe;
use crate::profile::Profile;
use crate::runner::Runner;
use crate::schedule::Schedule;
use crate::system::SystemRegistry;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalRunRequest {
    pub input: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bundle: Option<Bundle>,
    #[serde(default)]
    pub profile: Option<Profile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

pub fn run_local(
    host: &dyn HostPipe,
    registry: &SystemRegistry,
    loaded_bundle: Option<Bundle>,
    request: LocalRunRequest,
) -> Result<Value, RunError> {
    let bundle = match request.bundle {
        Some(bundle) => bundle,
        None => loaded_bundle.ok_or(RunError::NoBundleLoaded)?,
    };

    let present = registry.feature_sets();
    let missing = bundle.unmet_requirements(&present);
    if !missing.is_empty() {
        return Err(RunError::MissingFeatureSet {
            missing,
            present: present.iter().map(|s| s.to_string()).collect(),
        });
    }

    let child_run_id = request
        .run_id
        .unwrap_or_else(|| alloc::format!("local_{}", host.now_ms()));

    crate::capability::runtime::push_context(
        host,
        Some(child_run_id.as_str()),
        request.profile.as_ref(),
    )
    .map_err(|e| RunError::Internal {
        reason: alloc::format!("runtime.push_context: {}", e),
    })?;

    let result = run_local_entity(host, registry, bundle, request.input, child_run_id);

    let pop_result =
        crate::capability::runtime::pop_context(host).map_err(|e| RunError::Internal {
            reason: alloc::format!("runtime.pop_context: {}", e),
        });

    match (result, pop_result) {
        (Ok(out), Ok(())) => Ok(out),
        (Err(err), Ok(())) => Err(err),
        (Ok(_), Err(pop_err)) => Err(pop_err),
        (Err(err), Err(_pop_err)) => Err(err),
    }
}

fn run_local_entity(
    host: &dyn HostPipe,
    registry: &SystemRegistry,
    bundle: Bundle,
    input: Value,
    run_id: String,
) -> Result<Value, RunError> {
    let mut entity = Entity::default();
    entity.run_id = Some(run_id);
    entity.identity = Some(Identity {
        principal: "owner".into(),
        tenant: None,
        session: None,
    });
    entity.input = Some(input);
    entity.bundle = Some(bundle);

    let schedule = entity
        .bundle
        .as_ref()
        .and_then(|bundle| bundle.schedule.clone())
        .unwrap_or_else(Schedule::predict_default);

    let mut runner = Runner::new(&mut entity, registry, &schedule, host);
    runner.run_to_completion()
}
