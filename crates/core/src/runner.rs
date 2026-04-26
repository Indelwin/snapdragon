//! Runner — drives an Entity through its Schedule.
//!
//! design-v4 §4. At each step, the runner:
//!   1. Picks the next `SystemInvocation` from the Schedule.
//!   2. Looks up the system by name in the local registry.
//!   3. If known: runs it against the entity, applies the resulting
//!      `SystemDelta`, emits its events.
//!   4. If unknown: calls `capability::call_raw("system.<name>@1",
//!      serialised_entity_view)` and applies the returned delta.
//!   5. Checks for terminal components (`Final` / `Error`) or signals.
//!   6. Loops until terminal or schedule exhausted.
//!
//! The runner is ignorant of module types — it just drives schedules.
//! Module types live as default schedules on the bundle.
//!
//! v0.1-alpha: shape + registry lookup + terminal check. Applying
//! deltas and calling systems lands with the adapter + first system
//! implementations in the next commit.

use crate::component::Entity;
use crate::error::RunError;
use crate::host::HostPipe;
use crate::schedule::{Schedule, ScheduleStep};
use crate::system::{SystemDelta, SystemRegistry};
use alloc::string::String;

/// Runner driving one Entity through its Schedule using a provided
/// system registry + host pipe.
pub struct Runner<'a> {
    pub entity: &'a mut Entity,
    pub registry: &'a SystemRegistry,
    pub schedule: &'a Schedule,
    pub host: &'a dyn HostPipe,
}

impl<'a> Runner<'a> {
    pub fn new(
        entity: &'a mut Entity,
        registry: &'a SystemRegistry,
        schedule: &'a Schedule,
        host: &'a dyn HostPipe,
    ) -> Self {
        Self {
            entity,
            registry,
            schedule,
            host,
        }
    }

    /// Drive the entity to completion (Final or Error present), or
    /// until the schedule is exhausted without terminal. Returns the
    /// final output value or the error.
    pub fn run_to_completion(&mut self) -> Result<serde_json::Value, RunError> {
        for step in &self.schedule.steps {
            self.run_step(step)?;
            if self.entity.is_terminal() {
                break;
            }
        }
        if let Some(err) = &self.entity.error {
            Err(err.clone())
        } else if let Some(out) = &self.entity.final_output {
            Ok(out.clone())
        } else {
            Err(RunError::Internal {
                reason: "schedule exhausted without Final or Error".into(),
            })
        }
    }

    fn run_step(&mut self, step: &ScheduleStep) -> Result<(), RunError> {
        match step {
            ScheduleStep::Invoke(inv) => self.run_invocation(inv),
            ScheduleStep::Loop {
                body,
                max_iters,
                until,
                ..
            } => {
                // `max_iters: None` = unbounded. Termination still
                // comes from the entity reaching a terminal state
                // (Final or Error) or the `until` predicate being
                // satisfied. An explicit `max_iters` acts as a hard
                // safety net for callers who want one.
                let mut iter: u32 = 0;
                loop {
                    for inner in body {
                        self.run_step(inner)?;
                        if self.entity.is_terminal() {
                            return Ok(());
                        }
                    }
                    if self.loop_satisfied(until) {
                        return Ok(());
                    }
                    iter = iter.saturating_add(1);
                    if let Some(cap) = max_iters {
                        if iter >= *cap {
                            return Ok(());
                        }
                    }
                }
            }
        }
    }

    /// Evaluate a loop termination predicate against the current
    /// entity state. Returns true when the loop should break early.
    fn loop_satisfied(&self, until: &crate::schedule::LoopTermination) -> bool {
        use crate::schedule::LoopTermination;
        match until {
            LoopTermination::MaxIters => false, // handled by the outer for-loop
            LoopTermination::ComponentPresence { component, present } => {
                let is_present = self.component_is_present(component);
                is_present == *present
            }
        }
    }

    /// Whether a named component is currently present on the entity.
    /// Used by the loop-predicate machinery. Accepts string names that
    /// match the `ComponentName::as_str` set plus the extension-bag
    /// keys.
    fn component_is_present(&self, name: &str) -> bool {
        let normalized = name
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .map(|c| c.to_ascii_lowercase())
            .collect::<String>();

        match normalized.as_str() {
            "runid" => self.entity.run_id.is_some(),
            "identity" => self.entity.identity.is_some(),
            "input" => self.entity.input.is_some(),
            "bundle" => self.entity.bundle.is_some(),
            "profile" => self.entity.profile.is_some(),
            "schedule" => self.entity.schedule.is_some(),
            "currentmessages" => self.entity.current_messages.is_some(),
            "pendingllmcall" => self.entity.pending_llm_call.is_some(),
            "lastllmresponse" => self.entity.last_llm_response.is_some(),
            "parsedaction" => self.entity.parsed_action.is_some(),
            "pendingtoolcall" => self.entity.pending_tool_call.is_some(),
            "lastobservation" => self.entity.last_observation.is_some(),
            "sessionid" => self.entity.session_id.is_some(),
            "itercounter" => self.entity.iter_counter.is_some(),
            "availabletools" => !self.entity.available_tools.is_empty(),
            "pendingtoolcalls" => !self.entity.pending_tool_calls.is_empty(),
            "lastthinkingblocks" => !self.entity.last_thinking_blocks.is_empty(),
            "trajectory" => !self.entity.trajectory.is_empty(),
            "final" | "finaloutput" => self.entity.final_output.is_some(),
            "error" => self.entity.error.is_some(),
            // Schedules may also reference extension-bag components by
            // the key they were written under.
            _ => self.entity.extensions.contains_key(name),
        }
    }

    fn run_invocation(&mut self, inv: &crate::schedule::SystemInvocation) -> Result<(), RunError> {
        let max_attempts = inv
            .retry_on_fail
            .as_ref()
            .map(|p| p.max.max(1))
            .unwrap_or(1);
        let mut attempts = 1u32;

        loop {
            match self.run_invocation_once(inv) {
                Ok(()) => return Ok(()),
                Err(err) => {
                    if attempts >= max_attempts || inv.retry_on_fail.is_none() {
                        return Err(self.finalize_retry_error(err, attempts));
                    }
                    self.prepare_retry(inv, attempts, &err)?;
                    attempts += 1;
                }
            }
        }
    }

    fn run_invocation_once(
        &mut self,
        inv: &crate::schedule::SystemInvocation,
    ) -> Result<(), RunError> {
        if let Some(system) = self.registry.get(&inv.system) {
            let delta = system.run(self.entity, self.host, &inv.args)?;
            self.apply(delta);
            Ok(())
        } else {
            // Unknown system name → dispatch to a host-side system
            // handler via `system.<name>@1`. This is the ECS extension
            // seam: wrappers register capability handlers under names
            // like `system.detect_tool_call@1` to implement custom
            // systems without touching the core.
            self.run_host_system(inv)
        }
    }

    fn prepare_retry(
        &mut self,
        inv: &crate::schedule::SystemInvocation,
        attempts_used: u32,
        err: &RunError,
    ) -> Result<(), RunError> {
        let policy = inv
            .retry_on_fail
            .as_ref()
            .ok_or_else(|| RunError::Internal {
                reason: format!("retry requested for `{}` without retry policy", inv.system),
            })?;

        if inv.system == "ParseResponse" {
            self.retry_parse_with_nudge(inv, attempts_used, err, policy)
        } else {
            Ok(())
        }
    }

    fn retry_parse_with_nudge(
        &mut self,
        inv: &crate::schedule::SystemInvocation,
        attempts_used: u32,
        err: &RunError,
        policy: &crate::schedule::RetryPolicy,
    ) -> Result<(), RunError> {
        let nudge = build_retry_nudge(inv, err, policy);
        let messages = self
            .entity
            .current_messages
            .as_mut()
            .ok_or_else(|| RunError::Internal {
                reason: "retry_on_fail for ParseResponse requires CurrentMessages".into(),
            })?;
        messages.push(crate::component::Message::user(nudge.clone()));

        self.entity.last_llm_response = None;
        self.entity.parsed_action = None;
        self.entity.pending_tool_call = None;
        self.entity.pending_tool_calls.clear();
        self.entity.last_thinking_blocks.clear();

        let payload = serde_json::json!({
            "system": inv.system,
            "attempt": attempts_used + 1,
            "nudge": nudge,
        });
        crate::event::emit_raw(
            self.host,
            crate::event::Topic::LlmParseRetried.as_str(),
            &payload.to_string(),
        );

        let call = self
            .registry
            .get("CallLlm")
            .ok_or_else(|| RunError::Internal {
                reason: "retry_on_fail for ParseResponse requires CallLlm".into(),
            })?;
        let delta = call.run(self.entity, self.host, &serde_json::Value::Null)?;
        self.apply(delta);

        if let Some(hook) = self.registry.get("Hook") {
            let delta = hook.run(
                self.entity,
                self.host,
                &serde_json::json!({ "hook": "after_llm_response" }),
            )?;
            self.apply(delta);
        }

        Ok(())
    }

    fn finalize_retry_error(&self, err: RunError, attempts_used: u32) -> RunError {
        match err {
            RunError::LlmParseFailed { last_error, .. } => RunError::LlmParseFailed {
                attempts: attempts_used,
                last_error,
            },
            other => other,
        }
    }

    fn run_host_system(&mut self, inv: &crate::schedule::SystemInvocation) -> Result<(), RunError> {
        use crate::host_system::{EntityView, HostSystemRequest, HostSystemResponse};

        let cap_name = format!("system.{}@1", inv.system);
        let request = HostSystemRequest {
            args: inv.args.clone(),
            view: EntityView::from_entity(self.entity),
        };
        let request_json = serde_json::to_string(&request).map_err(|e| RunError::Internal {
            reason: format!("encoding host-system request: {}", e),
        })?;

        let response_json = self
            .host
            .call_capability(&cap_name, &request_json)
            .map_err(|e| match e {
                crate::host::CallError::NotProvided { .. } => RunError::Internal {
                    reason: format!(
                        "unknown system `{}` (no Rust registration, no host handler for `{}`)",
                        inv.system, cap_name
                    ),
                },
                other => RunError::Internal {
                    reason: format!("host system `{}` failed: {:?}", inv.system, other),
                },
            })?;

        let response: HostSystemResponse =
            serde_json::from_str(&response_json).map_err(|e| RunError::Internal {
                reason: format!("decoding host-system response from `{}`: {}", cap_name, e),
            })?;

        self.apply_host_response(response);
        Ok(())
    }

    fn apply_host_response(&mut self, r: crate::host_system::HostSystemResponse) {
        // Mirror the Rust-side `apply` path, but over the narrower
        // HostSystemWrites set. Trust-bearing components (bundle,
        // identity, profile, schedule) are intentionally not writable
        // from host-side systems.
        let w = r.writes;
        if let Some(v) = w.current_messages {
            self.entity.current_messages = Some(v);
        }
        if let Some(v) = w.last_llm_response {
            self.entity.last_llm_response = Some(v);
        }
        if let Some(v) = w.parsed_action {
            self.entity.parsed_action = Some(v);
        }
        if let Some(v) = w.pending_tool_call {
            self.entity.pending_tool_call = v;
        }
        if let Some(v) = w.last_observation {
            self.entity.last_observation = Some(v);
        }
        if let Some(v) = w.session_id {
            self.entity.session_id = Some(v);
        }
        if let Some(v) = w.iter_counter {
            self.entity.iter_counter = Some(v);
        }
        if let Some(v) = w.available_tools {
            self.entity.available_tools = v;
        }
        if let Some(v) = w.pending_tool_calls {
            self.entity.pending_tool_calls = v;
        }
        if let Some(v) = w.last_thinking_blocks {
            self.entity.last_thinking_blocks = v;
        }
        for ev in w.trajectory_append {
            self.entity.trajectory.push(ev);
        }
        if let Some(v) = w.final_output {
            self.entity.final_output = Some(v);
        }
        for (k, v) in w.extensions {
            if v.is_null() {
                self.entity.extensions.remove(&k);
            } else {
                self.entity.extensions.insert(k, v);
            }
        }
        // Emit the host-system's events onto the bus.
        for (topic, payload) in r.events {
            crate::event::emit_raw(self.host, &topic, &payload.to_string());
        }
        // Signals: translate to the runner's internal shape. For v0.1
        // we only act on Finish (finalize) and Abort (error). Custom
        // signals get emitted as an event and otherwise ignored — loop
        // branch targets are declared in the schedule step, not here.
        match r.signal {
            Some(crate::host_system::HostSystemSignal::Finish) => {
                // Mark entity terminal via final_output if the system
                // didn't already set one. We use a null sentinel so
                // run_to_completion's "no final_output" check doesn't
                // think the run failed.
                if self.entity.final_output.is_none() {
                    self.entity.final_output = Some(serde_json::Value::Null);
                }
            }
            Some(crate::host_system::HostSystemSignal::Abort { reason }) => {
                self.entity.error = Some(RunError::HookAborted {
                    hook: "host_system".into(),
                    reason,
                });
            }
            Some(crate::host_system::HostSystemSignal::Custom { name: _ }) | None => {}
        }
    }

    fn apply(&mut self, delta: SystemDelta) {
        // Apply `writes`.
        let w = delta.writes;
        if let Some(v) = w.profile {
            self.entity.profile = Some(v);
        }
        if let Some(v) = w.schedule {
            self.entity.schedule = Some(v);
        }
        if let Some(v) = w.current_messages {
            self.entity.current_messages = Some(v);
        }
        if let Some(v) = w.pending_llm_call {
            self.entity.pending_llm_call = v;
        }
        if let Some(v) = w.last_llm_response {
            self.entity.last_llm_response = Some(v);
        }
        if let Some(v) = w.parsed_action {
            self.entity.parsed_action = Some(v);
        }
        if let Some(v) = w.pending_tool_call {
            self.entity.pending_tool_call = v;
        }
        if let Some(v) = w.last_observation {
            self.entity.last_observation = Some(v);
        }
        if let Some(v) = w.session_id {
            self.entity.session_id = Some(v);
        }
        if let Some(v) = w.iter_counter {
            self.entity.iter_counter = Some(v);
        }
        if let Some(v) = w.available_tools {
            self.entity.available_tools = v;
        }
        if let Some(v) = w.pending_tool_calls {
            self.entity.pending_tool_calls = v;
        }
        if let Some(v) = w.last_thinking_blocks {
            self.entity.last_thinking_blocks = v;
        }
        for ev in w.trajectory_append {
            self.entity.trajectory.push(ev);
        }
        if let Some(v) = w.final_output {
            self.entity.final_output = Some(v);
        }
        if let Some(v) = w.error {
            self.entity.error = Some(v);
        }
        for (k, v) in w.extensions {
            self.entity.extensions.insert(k, v);
        }
        // Emit events.
        for (topic, payload) in delta.events {
            let json = payload.to_string();
            crate::event::emit_raw(self.host, topic.as_str(), &json);
        }
        // Signal handling (loop break etc.) lands with the loop
        // control-flow work in the next commit.
        let _ = delta.signal;
    }
}

fn build_retry_nudge(
    inv: &crate::schedule::SystemInvocation,
    err: &RunError,
    policy: &crate::schedule::RetryPolicy,
) -> String {
    let prefix = policy
        .nudge
        .clone()
        .unwrap_or_else(|| "Your previous response failed. Retry carefully.".into());

    match err {
        RunError::LlmParseFailed { last_error, .. } => format!(
            "{}\n\nYour previous response could not be parsed: {}\nReply again and follow the required output format exactly.",
            prefix, last_error
        ),
        other => format!("{}\n\nSystem `{}` failed: {}", prefix, inv.system, other),
    }
}

// Use alloc::format for the inline error builder above.
use alloc::format;
