//! Schedule — module behaviour as declarative data.
//!
//! design-v4 §5. A schedule is a typed, bundle-declared sequence of
//! systems + control-flow primitives. The module type (Predict, ReACT,
//! RLM) determines the default schedule; a host may override via the
//! `schedule.resolve@1` capability.
//!
//! v0.1 schedule primitives, deliberately minimal:
//!   - Linear sequence of `SystemInvocation`s.
//!   - `Loop { until, max_iters, body }` — loop terminated by `until`
//!     predicate, entity terminal (Final/Error), or (optionally) a
//!     hard `max_iters` cap. `max_iters: None` = unbounded.
//!   - `retry_on_fail` on any invocation.
//!   - `on_finish` / `on_error` branches for known signals.
//!
//! Anything more complex: write a host-side system.

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A complete schedule for one entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    pub steps: Vec<ScheduleStep>,
}

/// One step in the schedule. Either a single system invocation or a
/// One step in the schedule. Either a single system invocation or a
/// loop. Loops iterate until `until` is satisfied, or the terminal
/// state (`Final`/`Error`) is reached on the entity, or — optionally —
/// `max_iters` iterations have elapsed.
///
/// `max_iters: None` means unbounded. That's the right default for
/// ReACT-style tool loops: real work legitimately runs for dozens or
/// thousands of turns, and the `until` predicate + terminal check are
/// already responsible for termination. An explicit cap is for
/// situations where the caller wants a hard safety net.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScheduleStep {
    Invoke(SystemInvocation),
    Loop {
        id: String,
        until: LoopTermination,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_iters: Option<u32>,
        body: Vec<ScheduleStep>,
    },
}

/// A single system invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInvocation {
    /// Stable id within this schedule — used in events / errors.
    pub id: String,
    /// Name of the system to invoke. Core resolves via its registry;
    /// unknown names fall through to `call-capability("system.<name>@1", ...)`.
    pub system: String,
    /// System-specific args, passed through opaque.
    #[serde(default)]
    pub args: Value,
    /// Optional retry policy on parse/system failure.
    #[serde(default)]
    pub retry_on_fail: Option<RetryPolicy>,
    /// Optional named branches on specific termination signals the
    /// system may emit (e.g. ReACT's `CheckFinishTool` emits "finish").
    #[serde(default)]
    pub on_signal: Option<BTreeMapLikeOnSignal>,
}

// serde helper — a map whose keys are signal names and values are
// control-flow decisions. We use a small struct-of-options rather than
// a true map because serde_json's untagged-enum resolution gets noisy
// with arbitrary-key maps across wasm boundaries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BTreeMapLikeOnSignal {
    /// e.g. for ReACT's finish signal: "break_to_extract".
    #[serde(default)]
    pub finish: Option<BranchTarget>,
    #[serde(default)]
    pub abort: Option<BranchTarget>,
    #[serde(default)]
    pub custom: alloc::collections::BTreeMap<String, BranchTarget>,
}

/// What to do on a particular signal.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BranchTarget {
    /// Break out of the enclosing loop, continue with steps after it.
    BreakLoop,
    /// Break out of the enclosing loop AND jump directly to the named step.
    BreakLoopTo { target: String },
    /// Terminate the run now with whatever `Final` is present, or an
    /// error if not.
    Finalize,
    /// Raise a `RunError::HookAborted` with the given reason.
    Abort { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub max: u32,
    /// Optional message to append to messages on retry, signalling the
    /// model to correct its output.
    #[serde(default)]
    pub nudge: Option<String>,
}

/// Predicate for loop termination.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LoopTermination {
    /// Stop when the named component is present (or absent).
    ComponentPresence { component: String, present: bool },
    /// Stop when `IterCounter.iter >= max_iters`. Implicit from the
    /// loop's `max_iters`; this variant lets a bundle explicitly
    /// state it for clarity.
    MaxIters,
}

impl Schedule {
    /// Default schedule for a Predict module. Placeholder shape —
    /// real helpers land when the runner is wired.
    pub fn predict_default() -> Self {
        Self {
            steps: alloc::vec![
                inv("resolve_profile", "ResolveProfile"),
                inv("resolve_schedule", "ResolveSchedule"),
                inv("render", "RenderPrompt"),
                inv("hook_before_llm", "Hook").with_args(hook_args("before_llm_request")),
                inv("call", "CallLlm"),
                inv("hook_after_llm", "Hook").with_args(hook_args("after_llm_response")),
                inv("parse", "ParseResponse").with_retry(RetryPolicy {
                    max: 3,
                    nudge: Some("Your previous response did not parse. Retry carefully.".into())
                }),
                inv("finalize", "Finalize"),
            ],
        }
    }
}

fn inv(id: &str, system: &str) -> ScheduleStep {
    ScheduleStep::Invoke(SystemInvocation {
        id: id.into(),
        system: system.into(),
        args: Value::Null,
        retry_on_fail: None,
        on_signal: None,
    })
}

fn hook_args(hook_name: &str) -> Value {
    serde_json::json!({ "hook": hook_name })
}

trait InvoBuilder {
    fn with_args(self, args: Value) -> Self;
    fn with_retry(self, policy: RetryPolicy) -> Self;
}

impl InvoBuilder for ScheduleStep {
    fn with_args(mut self, args: Value) -> Self {
        if let ScheduleStep::Invoke(i) = &mut self {
            i.args = args;
        }
        self
    }
    fn with_retry(mut self, policy: RetryPolicy) -> Self {
        if let ScheduleStep::Invoke(i) = &mut self {
            i.retry_on_fail = Some(policy);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn predict_default_is_eight_steps() {
        let sched = Schedule::predict_default();
        assert_eq!(sched.steps.len(), 8);
        match &sched.steps[3] {
            ScheduleStep::Invoke(i) => assert_eq!(i.system, "Hook"),
            _ => panic!("expected hook invocation"),
        }
    }

    #[test]
    fn schedule_json_round_trips() {
        let s = Schedule::predict_default();
        let j = serde_json::to_string(&s).unwrap();
        let back: Schedule = serde_json::from_str(&j).unwrap();
        assert_eq!(back.steps.len(), s.steps.len());
    }
}
