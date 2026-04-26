//! Compiled bundle: what the optimizer emits and the agent consumes.
//!
//! A bundle is just JSON with a canonical encoding (RFC 8785 JCS-style,
//! achieved in practice by serde_json with sorted keys + no whitespace) and
//! a blake3 content ID. Signatures (ed25519) are attached in an outer
//! envelope, not inside the bundle body, so hashing is stable regardless
//! of signing.

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::profile::Profile;
use crate::schedule::Schedule;
use crate::signature::Signature;

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bundle {
    #[serde(rename = "$schema")]
    pub schema: u32,

    pub program_id: String,
    pub program_version: String,

    /// All signatures referenced by the program's modules, keyed by signature name.
    pub signatures: Vec<Signature>,

    /// Optional profile the bundle ships as the default. Host may
    /// override via `profile.get@1`; composition is last-write-wins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_profile: Option<Profile>,

    /// Optional bundle-declared schedule. If absent, core uses the
    /// default schedule for the program's module kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schedule: Option<Schedule>,

    /// Feature sets this bundle requires from the runner's
    /// `SystemRegistry`. Example: `["predict"]` for a plain Predict
    /// bundle, `["predict", "react"]` for a ReACT bundle that also
    /// needs tool-calling systems. If any required set is missing at
    /// load time the runner returns `RunError::MissingFeatureSet`.
    ///
    /// An empty list means "no requirements" — the bundle can run on
    /// `SystemRegistry::minimal()`. Useful for bundles that do all
    /// their work via host capabilities.
    #[serde(default)]
    pub requires: Vec<String>,

    pub compiled: Compiled,

    #[serde(default)]
    pub metadata: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Compiled {
    #[serde(default)]
    pub instructions_by_module: BTreeMap<String, String>,
    #[serde(default)]
    pub demos_by_module: BTreeMap<String, Vec<Value>>,
}

#[derive(Debug)]
pub enum BundleError {
    UnsupportedSchema(u32),
    Decode(serde_json::Error),
}

impl core::fmt::Display for BundleError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            BundleError::UnsupportedSchema(v) => write!(f, "unsupported schema version {}", v),
            BundleError::Decode(e) => write!(f, "bundle decode error: {}", e),
        }
    }
}

impl Bundle {
    pub fn from_json(bytes: &[u8]) -> Result<Self, BundleError> {
        let b: Bundle = serde_json::from_slice(bytes).map_err(BundleError::Decode)?;
        if b.schema != SCHEMA_VERSION {
            return Err(BundleError::UnsupportedSchema(b.schema));
        }
        Ok(b)
    }

    /// Return the subset of `self.requires` that are NOT satisfied by
    /// `present`. Empty list = all requirements satisfied.
    ///
    /// Callers use this at bundle-install time to reject a bundle
    /// whose declared feature sets (e.g. `["predict", "react"]`) can't
    /// be served by the runner's current registry.
    pub fn unmet_requirements(&self, present: &[&str]) -> Vec<String> {
        self.requires
            .iter()
            .filter(|req| !present.iter().any(|p| p == &req.as_str()))
            .cloned()
            .collect()
    }

    /// The first signature in the bundle. Predict-shape programs only
    /// have one; multi-signature ReACT/RLM bundles will pick by name.
    pub fn primary_signature(&self) -> Option<&Signature> {
        self.signatures.first()
    }

    /// Canonical JSON encoding. serde_json's default is not RFC 8785, but
    /// with a BTreeMap everywhere and `to_vec` (no pretty) we get a stable
    /// byte representation sufficient for content-addressing *our own*
    /// bundles. For cross-implementation canonicalisation we'll add a full
    /// JCS pass in v0.2.
    pub fn to_canonical_json(&self) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(self)
    }

    /// Content ID: blake3 over the canonical bytes, base32 (no padding),
    /// prefixed `b` for multibase hint. Not a formal IPLD CID.
    pub fn cid(&self) -> Result<String, serde_json::Error> {
        let bytes = self.to_canonical_json()?;
        Ok(cid_of(&bytes))
    }
}

/// Compute a CID for already-canonical bytes. Exposed so the CLI can hash
/// raw files without round-tripping through the Bundle type.
pub fn cid_of(canonical_bytes: &[u8]) -> String {
    let hash = blake3::hash(canonical_bytes);
    // Minimal base32 (RFC 4648, lowercase, no padding) — avoid pulling a
    // whole multibase crate. 32 bytes → 52 chars.
    let mut out = String::with_capacity(53);
    out.push('b');
    base32_lower_no_pad(hash.as_bytes(), &mut out);
    out
}

fn base32_lower_no_pad(input: &[u8], out: &mut String) {
    const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut buf: u64 = 0;
    let mut bits: u32 = 0;
    for &byte in input {
        buf = (buf << 8) | (byte as u64);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            let idx = ((buf >> bits) & 0x1F) as usize;
            out.push(ALPHABET[idx] as char);
        }
    }
    if bits > 0 {
        let idx = ((buf << (5 - bits)) & 0x1F) as usize;
        out.push(ALPHABET[idx] as char);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signature::{Field, FieldType, Signature};

    fn sample_bundle() -> Bundle {
        Bundle {
            schema: SCHEMA_VERSION,
            program_id: "demo.agent".into(),
            program_version: "0.1.0".into(),
            signatures: vec![Signature {
                name: "Answer".into(),
                doc: Some("Answer a short question.".into()),
                inputs: vec![Field {
                    name: "question".into(),
                    ty: FieldType::String,
                    doc: None,
                }],
                outputs: vec![Field {
                    name: "answer".into(),
                    ty: FieldType::String,
                    doc: None,
                }],
            }],
            default_profile: None,
            schedule: None,
            requires: vec!["predict".into(), "tools".into()],
            compiled: Compiled::default(),
            metadata: BTreeMap::new(),
        }
    }

    fn reference_base32_lower_no_pad(input: &[u8]) -> String {
        const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
        let mut out = String::new();
        let mut value: u16 = 0;
        let mut bits: u8 = 0;

        for &byte in input {
            value = (value << 8) | u16::from(byte);
            bits += 8;
            while bits >= 5 {
                let shift = bits - 5;
                let idx = ((value >> shift) & 0b11111) as usize;
                out.push(ALPHABET[idx] as char);
                value &= (1 << shift) - 1;
                bits = shift;
            }
        }

        if bits > 0 {
            let idx = ((value << (5 - bits)) & 0b11111) as usize;
            out.push(ALPHABET[idx] as char);
        }

        out
    }

    fn reference_cid_of(canonical_bytes: &[u8]) -> String {
        let hash = blake3::hash(canonical_bytes);
        let mut out = String::from("b");
        out.push_str(&reference_base32_lower_no_pad(hash.as_bytes()));
        out
    }

    #[test]
    fn cid_is_deterministic() {
        let a = cid_of(b"hello world");
        let b = cid_of(b"hello world");
        assert_eq!(a, b);
        assert!(a.starts_with('b'));
        assert_eq!(a.len(), 1 + 52);
        assert_eq!(a, reference_cid_of(b"hello world"));
    }

    #[test]
    fn cid_changes_on_input_change() {
        assert_ne!(cid_of(b"a"), cid_of(b"b"));
    }

    #[test]
    fn cid_matches_reference_base32_for_edge_inputs() {
        for input in [
            b"".as_slice(),
            b"a".as_slice(),
            b"abc".as_slice(),
            b"hello world".as_slice(),
        ] {
            assert_eq!(cid_of(input), reference_cid_of(input));
        }
    }

    #[test]
    fn bundle_error_display_includes_context() {
        assert_eq!(
            BundleError::UnsupportedSchema(99).to_string(),
            "unsupported schema version 99"
        );

        let err = Bundle::from_json(b"{").unwrap_err();
        assert!(err.to_string().starts_with("bundle decode error: "));
    }

    #[test]
    fn bundle_json_round_trip_and_schema_validation() {
        let bundle = sample_bundle();
        let bytes = bundle.to_canonical_json().unwrap();
        assert!(bytes.len() > 32);

        let decoded = Bundle::from_json(&bytes).unwrap();
        assert_eq!(decoded.program_id, "demo.agent");
        assert_eq!(decoded.requires, ["predict", "tools"]);

        let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        value["$schema"] = serde_json::json!(SCHEMA_VERSION + 1);
        let err = Bundle::from_json(&serde_json::to_vec(&value).unwrap()).unwrap_err();
        assert!(matches!(err, BundleError::UnsupportedSchema(v) if v == SCHEMA_VERSION + 1));
    }

    #[test]
    fn bundle_requirement_and_primary_signature_helpers_are_observable() {
        let bundle = sample_bundle();
        assert_eq!(bundle.unmet_requirements(&["predict"]), ["tools"]);
        assert_eq!(
            bundle.unmet_requirements(&["predict", "tools"]),
            Vec::<String>::new()
        );
        assert_eq!(bundle.primary_signature().unwrap().name, "Answer");
    }

    #[test]
    fn bundle_cid_is_hash_of_canonical_json() {
        let bundle = sample_bundle();
        let canonical = bundle.to_canonical_json().unwrap();
        assert_eq!(bundle.cid().unwrap(), cid_of(&canonical));
    }
}
