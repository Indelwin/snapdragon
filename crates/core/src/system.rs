//! System — a named transform on an Entity, with access to the host.
//!
//! design-v4 §4. A system reads some components, writes others, emits
//! zero or more events, and returns either a delta or an error. Core
//! maintains a registry keyed by name. Unknown names in a schedule
//! fall through to `host.call_capability("system.<name>@1", ...)`
//! (future work).

use alloc::boxed::Box;
use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::component::{ComponentName, Entity, Message};
use crate::error::RunError;
use crate::event::Topic;
use crate::host::HostPipe;

/// Output of running one system: component writes + events to emit
/// + optional control-flow signal (for loop/branch primitives).
pub struct SystemDelta {
    pub writes: ComponentWrites,
    pub events: Vec<(Topic, Value)>,
    pub signal: Option<Signal>,
}

impl Default for SystemDelta {
    fn default() -> Self {
        Self {
            writes: ComponentWrites::default(),
            events: Vec::new(),
            signal: None,
        }
    }
}

/// Writable component fields. `None` = leave unchanged; `Some(Some(_))`
/// = set; `Some(None)` = clear. This three-state is needed for
/// `pending_*` components which the runner needs to clear after
/// consuming.
#[derive(Default)]
pub struct ComponentWrites {
    pub profile: Option<crate::profile::Profile>,
    pub schedule: Option<crate::schedule::Schedule>,
    pub current_messages: Option<Vec<Message>>,
    pub pending_llm_call: Option<Option<crate::component::PendingLlmCall>>,
    pub last_llm_response: Option<String>,
    pub parsed_action: Option<Value>,
    pub pending_tool_call: Option<Option<crate::component::PendingToolCall>>,
    pub last_observation: Option<String>,
    pub session_id: Option<String>,
    pub iter_counter: Option<crate::component::IterCounter>,
    pub available_tools: Option<Vec<crate::component::ToolDefinitionRef>>,
    pub pending_tool_calls: Option<Vec<crate::component::ToolCall>>,
    pub last_thinking_blocks: Option<Vec<crate::component::ThinkingBlock>>,
    pub trajectory_append: Vec<crate::trajectory::TrajectoryEvent>,
    pub final_output: Option<Value>,
    pub error: Option<RunError>,
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Debug, Clone)]
pub enum Signal {
    Finish,
    Abort(String),
    Custom(String),
}

/// Systems live in a registry keyed by stable name. They read an
/// entity snapshot + the host pipe + their own arguments, and return
/// a delta.
pub trait System {
    fn name(&self) -> &'static str;
    fn reads(&self) -> &'static [ComponentName];
    fn writes(&self) -> &'static [ComponentName];
    fn run(
        &self,
        entity: &Entity,
        host: &dyn HostPipe,
        args: &Value,
    ) -> Result<SystemDelta, RunError>;
}

pub struct SystemRegistry {
    systems: BTreeMap<&'static str, Box<dyn System + Send + Sync>>,
}

impl SystemRegistry {
    pub fn new() -> Self {
        Self {
            systems: BTreeMap::new(),
        }
    }

    pub fn register<S: System + Send + Sync + 'static>(&mut self, s: S) {
        self.systems.insert(s.name(), Box::new(s));
    }

    pub fn get(&self, name: &str) -> Option<&(dyn System + Send + Sync)> {
        self.systems.get(name).map(|b| b.as_ref())
    }

    pub fn names(&self) -> Vec<&'static str> {
        self.systems.keys().copied().collect()
    }

    /// Minimal kernel — only the always-present `Hook` dispatcher.
    /// Call `.with_predict()` / `.with_react()` / `.with_rlm()` to
    /// add feature-specific systems. See the `agent-ecs` design
    /// principle: the kernel contains no agent architectures, only
    /// the primitives they compose from.
    pub fn minimal() -> Self {
        use crate::systems::HookSystem;
        let mut r = Self::new();
        r.register(HookSystem);
        r
    }

    /// Add the systems needed to run a Predict module (render prompt,
    /// call LLM, parse response, finalize). Chainable.
    pub fn with_predict(mut self) -> Self {
        use crate::systems::*;
        self.register(ResolveProfileSystem);
        self.register(ResolveScheduleSystem);
        self.register(RenderPromptSystem);
        self.register(CallLlmSystem);
        self.register(ParseResponseSystem);
        self.register(FinalizeSystem);
        self
    }

    /// Shorthand for `minimal().with_predict()`. Matches the bundle
    /// capability set `predict`. Kept for backwards-compatibility with
    /// the original tests; new code should prefer explicit composition.
    pub fn core_defaults() -> Self {
        Self::minimal().with_predict()
    }

    /// Returns the set of `FeatureSet`s this registry satisfies. Used
    /// by the runner to validate `Bundle.requires` at load time.
    pub fn feature_sets(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        // `predict` iff all Predict-flavoured systems are present.
        let predict_members: [&'static str; 6] = [
            "ResolveProfile",
            "ResolveSchedule",
            "RenderPrompt",
            "CallLlm",
            "ParseResponse",
            "Finalize",
        ];
        if predict_members.iter().all(|n| self.get(n).is_some()) {
            out.push("predict");
        }
        // Always present by virtue of minimal().
        if self.get("Hook").is_some() {
            out.push("core");
        }
        out
    }
}

impl Default for SystemRegistry {
    fn default() -> Self {
        Self::core_defaults()
    }
}

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::*;
    use crate::host::mock::MockHostPipe;

    struct NoopSystem;
    impl System for NoopSystem {
        fn name(&self) -> &'static str {
            "Noop"
        }
        fn reads(&self) -> &'static [ComponentName] {
            &[]
        }
        fn writes(&self) -> &'static [ComponentName] {
            &[]
        }
        fn run(&self, _e: &Entity, _h: &dyn HostPipe, _a: &Value) -> Result<SystemDelta, RunError> {
            Ok(SystemDelta::default())
        }
    }

    #[test]
    fn registry_stores_and_retrieves() {
        let mut r = SystemRegistry::new();
        r.register(NoopSystem);
        assert!(r.get("Noop").is_some());
        assert!(r.get("Missing").is_none());
    }

    #[test]
    fn core_defaults_registers_predict_systems() {
        let r = SystemRegistry::core_defaults();
        for name in &[
            "ResolveProfile",
            "ResolveSchedule",
            "RenderPrompt",
            "CallLlm",
            "ParseResponse",
            "Finalize",
        ] {
            assert!(r.get(name).is_some(), "missing system `{}`", name);
        }
    }

    #[test]
    fn minimal_has_only_hook() {
        let r = SystemRegistry::minimal();
        assert!(r.get("Hook").is_some());
        assert!(r.get("RenderPrompt").is_none());
        assert!(r.get("CallLlm").is_none());
    }

    #[test]
    fn with_predict_is_chainable() {
        let r = SystemRegistry::minimal().with_predict();
        assert!(r.get("Hook").is_some());
        assert!(r.get("RenderPrompt").is_some());
        assert!(r.get("CallLlm").is_some());
    }

    #[test]
    fn feature_sets_reflect_registration() {
        let minimal = SystemRegistry::minimal();
        assert_eq!(minimal.feature_sets(), vec!["core"]);

        let with_predict = SystemRegistry::minimal().with_predict();
        let sets = with_predict.feature_sets();
        assert!(sets.contains(&"core"));
        assert!(sets.contains(&"predict"));
    }

    #[test]
    fn noop_system_runs_with_mock_host() {
        let host = MockHostPipe::new();
        let sys = NoopSystem;
        let entity = Entity::default();
        sys.run(&entity, &host, &Value::Null).unwrap();
    }
}
