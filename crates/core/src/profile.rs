//! Profile: runtime composition of model routing, persona, tool allowlist,
//! safety policy. Explicit composition, no inheritance chain.

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Profile {
    /// Role → model ID. Roles are free-form strings agreed between Program
    /// and Profile ("planner", "reviewer", "cheap_classifier").
    #[serde(default)]
    pub role_to_model: BTreeMap<String, String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona: Option<String>,

    #[serde(default)]
    pub tool_allowlist: Vec<String>,

    #[serde(default)]
    pub skill_bundle_refs: Vec<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub safety_policy: Option<String>,
}

impl Profile {
    /// Merge `overlay` into `base`. Last-write-wins per field. Lists are
    /// replaced, not concatenated. BTreeMap entries are merged, with overlay
    /// winning on key collision.
    pub fn merge(mut base: Profile, overlay: Profile) -> Profile {
        for (k, v) in overlay.role_to_model {
            base.role_to_model.insert(k, v);
        }
        if overlay.persona.is_some() {
            base.persona = overlay.persona;
        }
        if !overlay.tool_allowlist.is_empty() {
            base.tool_allowlist = overlay.tool_allowlist;
        }
        if !overlay.skill_bundle_refs.is_empty() {
            base.skill_bundle_refs = overlay.skill_bundle_refs;
        }
        if overlay.safety_policy.is_some() {
            base.safety_policy = overlay.safety_policy;
        }
        base
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_overlay_wins_on_scalar() {
        let base = Profile {
            persona: Some("A".into()),
            ..Default::default()
        };
        let overlay = Profile {
            persona: Some("B".into()),
            ..Default::default()
        };
        assert_eq!(Profile::merge(base, overlay).persona, Some("B".into()));
    }

    #[test]
    fn merge_lists_replace_not_append() {
        let base = Profile {
            tool_allowlist: vec!["x".into()],
            ..Default::default()
        };
        let overlay = Profile {
            tool_allowlist: vec!["y".into()],
            ..Default::default()
        };
        assert_eq!(
            Profile::merge(base, overlay).tool_allowlist,
            vec!["y".to_string()]
        );
    }

    #[test]
    fn merge_roles_are_per_key() {
        let mut base = Profile::default();
        base.role_to_model.insert("planner".into(), "opus".into());
        base.role_to_model.insert("reviewer".into(), "haiku".into());
        let mut overlay = Profile::default();
        overlay
            .role_to_model
            .insert("reviewer".into(), "sonnet".into());
        let merged = Profile::merge(base, overlay);
        assert_eq!(merged.role_to_model.get("planner"), Some(&"opus".into()));
        assert_eq!(merged.role_to_model.get("reviewer"), Some(&"sonnet".into()));
    }
}
