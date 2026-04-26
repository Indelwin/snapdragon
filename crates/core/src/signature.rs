//! Runtime representation of a DSPy-shape Signature.
//!
//! A Signature is just typed input fields → typed output fields plus a
//! doc string. The proc-macro `#[signature]` emits a `const SIGNATURE_JSON`
//! matching this shape; the runtime deserialises it back into `Signature`
//! when it needs to prompt, validate, or mutate demos.
//!
//! v0.1 grammar: string | bool | enum<[...]> | list<T> | optional<T>.
//! `int`, `float`, `struct` land in v0.2.

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum FieldType {
    String,
    Bool,
    Enum { values: Vec<String> },
    List { inner: alloc::boxed::Box<FieldType> },
    Optional { inner: alloc::boxed::Box<FieldType> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Field {
    pub name: String,
    #[serde(flatten)]
    pub ty: FieldType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Signature {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
    pub inputs: Vec<Field>,
    pub outputs: Vec<Field>,
}

impl Signature {
    /// Parse a Signature from its canonical JSON encoding.
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }
}
