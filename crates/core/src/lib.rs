//! Snapdragon agent core.
//!
//! `no_std + alloc` (opt-in via the default `std` feature). WASM-first,
//! targeting WASI 0.2 components. All I/O flows through the two-pipe
//! WIT ABI (`wit/agent.wit`):
//!
//!   - `host::call_capability(cap, json)` — outbound request/response
//!   - `host::emit_event(topic, json)`     — outbound observability
//!   - `host::chat`, `host::now`, `host::random` — typed hot-path wrappers
//!
//! Full architectural rationale lives in
//! `Obsidian/Projects/snapdragon/design-v3.md` (ABI) and
//! `design-v4-scaling.md` (component/schedule/system model).
//!
//! Crate layout:
//! - `signature`   — Signature + Field types, JSON (de)serialisation.
//! - `adapter`     — render/parse for ChatAdapter (`[[ ## field ## ]]`) + JsonAdapter.
//! - `component`   — the typed component bag for one entity (one run).
//! - `schedule`    — bundle-declared schedule format + primitives.
//! - `system`      — System trait + registry of core systems.
//! - `module`      — Module trait, Predict, ChainOfThought, ReACT, RLM (stubs).
//! - `runner`      — drives an Entity through its Schedule.
//! - `bundle`      — compiled bundle loader, canonical JSON, blake3 CID.
//! - `profile`     — Profile composition (last-write-wins).
//! - `capability`  — typed helpers over `host::call_capability`.
//! - `event`       — typed helpers over `host::emit_event`.
//! - `hook`        — hook names + payload types + agent-side calling glue.
//! - `trajectory`  — structured step/run events.
//! - `error`       — structured error taxonomy used in `run` err arms.
//! - `wit`         — wit-bindgen glue against `wit/agent.wit`.

#![cfg_attr(not(feature = "std"), no_std)]
// wit-bindgen 0.36's `export!` expansion trips the 2024 edition's
// unsafe_op_in_unsafe_fn lint. Silence it until a 2024-aware release ships.
#![allow(unsafe_op_in_unsafe_fn)]

extern crate alloc;

pub mod adapter;
pub mod bundle;
pub mod capability;
pub mod component;
pub mod error;
pub mod event;
pub mod hook;
pub mod host;
pub mod host_system;
pub mod local_run;
pub mod module;
pub mod profile;
pub mod runner;
pub mod schedule;
pub mod signature;
pub mod system;
pub mod systems;
pub mod trajectory;

pub(crate) mod wit {
    //! WIT bindings generated from `../../wit/agent.wit`.
    //!
    //! Host imports: `call_capability`, `emit_event`, `chat`, `now`,
    //! `random`. Agent exports: `run`, `load_bundle`.
    wit_bindgen::generate!({
        world: "agent",
        path: "../../wit",
        generate_all,
    });

    use alloc::string::{String, ToString};
    use alloc::vec::Vec;

    use crate::bundle::Bundle;
    use crate::component::{Entity, Identity};
    use crate::error::RunError;
    use crate::host::WitHostPipe;
    use crate::local_run::LocalRunRequest;
    use crate::runner::Runner;
    use crate::schedule::Schedule;
    use crate::system::SystemRegistry;

    /// Process-wide state retained between `load_bundle` and `run`.
    /// The WASM component model gives us a single-threaded module
    /// instance per invocation, but wit-bindgen exports are plain
    /// functions, so we need somewhere to park the loaded bundle.
    /// `std::sync::Mutex` is fine — there's one thread inside a wasm
    /// instance.
    struct CoreState {
        bundle:   Option<Bundle>,
        registry: SystemRegistry,
    }

    fn state() -> &'static std::sync::Mutex<CoreState> {
        static STATE: std::sync::OnceLock<std::sync::Mutex<CoreState>> = std::sync::OnceLock::new();
        STATE.get_or_init(|| {
            std::sync::Mutex::new(CoreState {
                bundle:   None,
                registry: SystemRegistry::core_defaults(),
            })
        })
    }

    struct Impl;

    impl Guest for Impl {
        fn run(input_json: String) -> Result<String, String> {
            let host = WitHostPipe;
            let out = run_inner(&host, &input_json)
                .map_err(|e| e.to_err_arm())?;
            serde_json::to_string(&out)
                .map_err(|e| RunError::Internal { reason: alloc::format!("serialize output: {}", e) }.to_err_arm())
        }

        fn run_local(request_json: String) -> Result<String, String> {
            let host = WitHostPipe;
            let out = run_local_inner(&host, &request_json)
                .map_err(|e| e.to_err_arm())?;
            serde_json::to_string(&out)
                .map_err(|e| RunError::Internal { reason: alloc::format!("serialize output: {}", e) }.to_err_arm())
        }

        fn load_bundle(bundle_bytes: Vec<u8>) -> Result<String, String> {
            let bundle = Bundle::from_json(&bundle_bytes)
                .map_err(|e| alloc::format!("invalid bundle: {}", e))?;
            let cid = bundle
                .cid()
                .map_err(|e| alloc::format!("hashing bundle: {}", e))?;
            let mut g = state().lock().map_err(|_| "state mutex poisoned".to_string())?;

            // Validate the registry satisfies the bundle's required
            // feature sets.
            let present = g.registry.feature_sets();
            let missing = bundle.unmet_requirements(&present);
            if !missing.is_empty() {
                let err = RunError::MissingFeatureSet {
                    missing,
                    present: present.iter().map(|s| s.to_string()).collect(),
                };
                return Err(err.to_err_arm());
            }

            g.bundle = Some(bundle);
            Ok(cid)
        }
    }

    export!(Impl);

    /// The business-logic side of `run`, refactored out so tests in
    /// the `std` feature can drive it against a MockHostPipe without
    /// touching the WIT import shims.
    pub(crate) fn run_inner(
        host:       &dyn crate::host::HostPipe,
        input_json: &str,
    ) -> Result<serde_json::Value, RunError> {
        let g = state().lock().map_err(|_| RunError::Internal { reason: "state mutex poisoned".into() })?;
        let bundle = g.bundle.as_ref().ok_or(RunError::NoBundleLoaded)?.clone();
        let registry = &g.registry as *const SystemRegistry;
        // SAFETY: registry lives for the life of the process; we hold
        // a read-only reference and the mutex only guarded mutation.
        let registry = unsafe { &*registry };
        drop(g);

        // Defence-in-depth: if the bundle was installed via a path
        // that bypassed load_bundle (e.g. the test helper), still
        // enforce feature-set requirements here so a run never proceeds
        // on a registry that can't serve the bundle.
        let present = registry.feature_sets();
        let missing = bundle.unmet_requirements(&present);
        if !missing.is_empty() {
            return Err(RunError::MissingFeatureSet {
                missing,
                present: present.iter().map(|s| s.to_string()).collect(),
            });
        }

        let input: serde_json::Value = serde_json::from_str(input_json)
            .map_err(|e| RunError::InvalidInput { reason: e.to_string() })?;

        // Bundle-declared schedule wins; Predict default is the fallback
        // for bundles that don't ship one (the simple Predict case).
        let schedule = bundle
            .schedule
            .clone()
            .unwrap_or_else(Schedule::predict_default);

        let mut entity = Entity::default();
        entity.run_id    = Some(alloc::format!("run_{}", host.now_ms()));
        entity.identity  = Some(Identity { principal: "owner".into(), tenant: None, session: None });
        entity.input     = Some(input);
        entity.bundle    = Some(bundle);

        let mut runner = Runner::new(&mut entity, registry, &schedule, host);
        runner.run_to_completion()
    }

    pub(crate) fn run_local_inner(
        host: &dyn crate::host::HostPipe,
        request_json: &str,
    ) -> Result<serde_json::Value, RunError> {
        let g = state().lock().map_err(|_| RunError::Internal {
            reason: "state mutex poisoned".into(),
        })?;
        let bundle = g.bundle.clone();
        let registry = &g.registry as *const SystemRegistry;
        let registry = unsafe { &*registry };
        drop(g);

        let request: LocalRunRequest = serde_json::from_str(request_json)
            .map_err(|e| RunError::InvalidInput { reason: e.to_string() })?;

        crate::local_run::run_local(host, registry, bundle, request)
    }

    /// Test-only: set the loaded bundle directly, skipping the WIT
    /// export. Used by integration tests to avoid double-encoding.
    #[cfg(feature = "std")]
    pub fn install_bundle_for_test(bundle: Bundle) {
        state().lock().unwrap().bundle = Some(bundle);
    }
}

/// Test-only helper re-exported at crate root so integration tests can
/// call the runner the same way `run()` does, without going through
/// the WIT shim.
#[cfg(feature = "std")]
pub fn run_with_host(
    host:       &dyn host::HostPipe,
    input_json: &str,
) -> Result<serde_json::Value, error::RunError> {
    wit::run_inner(host, input_json)
}

#[cfg(feature = "std")]
pub fn run_local_with_host(
    host: &dyn host::HostPipe,
    request_json: &str,
) -> Result<serde_json::Value, error::RunError> {
    wit::run_local_inner(host, request_json)
}

#[cfg(feature = "std")]
pub fn install_bundle_for_test(bundle: bundle::Bundle) {
    wit::install_bundle_for_test(bundle);
}

// ---- re-exports for host bindings, tests, and downstream crates ----

pub use adapter::{Adapter, ChatAdapter, JsonAdapter};
pub use bundle::{Bundle, BundleError};
pub use capability::CapabilityName;
pub use component::{ComponentName, Entity, Identity, IterCounter, Message, Permissions};
pub use error::RunError;
pub use event::{Event, Topic};
pub use hook::{Hook, HookResponse};
pub use host::{CallError, HostPipe, WitHostPipe};
pub use local_run::LocalRunRequest;
pub use module::{Module, Predict};
pub use profile::Profile;
pub use runner::Runner;
pub use schedule::{Schedule, ScheduleStep, SystemInvocation};
pub use signature::{Field, FieldType, Signature};
pub use system::{System, SystemDelta, SystemRegistry};
pub use trajectory::TrajectoryEvent;
