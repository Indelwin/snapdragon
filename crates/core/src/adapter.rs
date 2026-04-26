//! Adapters — render/parse between signatures and chat messages.
//!
//! `ChatAdapter` mirrors DSPy's default wire format byte-for-byte:
//! `[[ ## field_name ## ]]` field headers, and `[[ ## completed ## ]]`
//! as the terminator. Compiled bundles from DSRs drop in without
//! translation.
//!
//! `JsonAdapter` is a simpler alternative for models with strict
//! JSON-mode support. Not implemented in this commit.
//!
//! The module is `no_std + alloc`. Zero regex — we parse the delimiter
//! form by linear scan.

use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use serde_json::Value;

use crate::signature::{Field, FieldType, Signature};

pub use crate::component::Message;

/// Pluggable prompt-format. Implementors round-trip through the wire:
/// `parse(render(inputs))` reproduces the declared output fields.
pub trait Adapter {
    /// Build the full prompt message list: system + demos + current inputs.
    fn render(
        &self,
        signature: &Signature,
        instructions: &str,
        demos: &[Value],
        inputs: &Value,
    ) -> Result<Vec<Message>, RenderError>;

    /// Parse an assistant response into a JSON object keyed by
    /// output field names.
    fn parse(&self, signature: &Signature, response: &str) -> Result<Value, ParseError>;
}

#[derive(Debug)]
pub enum RenderError {
    MissingInput { name: String },
    BadInputShape { name: String, reason: String },
}

#[derive(Debug, Clone)]
pub enum ParseError {
    MissingField(String),
    BadType {
        field: String,
        want: String,
        got: String,
    },
    NoTerminator,
    NoFields,
    Other(String),
}

impl core::fmt::Display for ParseError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::MissingField(n) => write!(f, "missing output field `{}`", n),
            Self::BadType { field, want, got } => {
                write!(f, "field `{}` expected {} got {}", field, want, got)
            }
            Self::NoTerminator => write!(f, "response missing `[[ ## completed ## ]]` terminator"),
            Self::NoFields => write!(f, "response contained no field headers"),
            Self::Other(m) => f.write_str(m),
        }
    }
}

// ========================================================================
// ChatAdapter — DSPy-compatible [[ ## field ## ]] format.
// ========================================================================

#[derive(Debug, Default)]
pub struct ChatAdapter;

impl Adapter for ChatAdapter {
    fn render(
        &self,
        signature: &Signature,
        instructions: &str,
        demos: &[Value],
        inputs: &Value,
    ) -> Result<Vec<Message>, RenderError> {
        let mut out = render_chat_prefix(signature, instructions, demos)?;

        // Current input.
        out.push(Message::user(render_user_turn(signature, inputs)?));

        Ok(out)
    }

    fn parse(&self, signature: &Signature, response: &str) -> Result<Value, ParseError> {
        // Find all `[[ ## name ## ]]` delimiters in order.
        let delimiters = find_delimiters(response);
        if delimiters.is_empty() {
            return Err(ParseError::NoFields);
        }

        // Must end with the `completed` sentinel. Non-fatal in lenient
        // parse; strict for now to match DSPy behaviour and catch
        // truncated responses early.
        let has_completed = delimiters.iter().any(|(name, _, _)| name == "completed");
        if !has_completed {
            return Err(ParseError::NoTerminator);
        }

        // Extract each output field's content: the slice from the end
        // of its header to the start of the NEXT header.
        let mut fields: BTreeMap<String, String> = BTreeMap::new();
        for i in 0..delimiters.len() {
            let (name, _start, end) = &delimiters[i];
            if name == "completed" {
                continue;
            }
            let content_start = *end;
            let content_end = if i + 1 < delimiters.len() {
                delimiters[i + 1].1 // start of next header
            } else {
                response.len()
            };
            let raw = response[content_start..content_end].trim();
            fields.insert(name.clone(), raw.to_string());
        }

        // Coerce string values to declared types.
        let mut obj = serde_json::Map::with_capacity(signature.outputs.len());
        for field in &signature.outputs {
            let raw = fields
                .remove(&field.name)
                .ok_or_else(|| ParseError::MissingField(field.name.clone()))?;
            obj.insert(field.name.clone(), coerce(&field.ty, &raw, &field.name)?);
        }

        Ok(Value::Object(obj))
    }
}

// ---- ChatAdapter helpers ----

pub(crate) fn render_chat_prefix(
    signature: &Signature,
    instructions: &str,
    demos: &[Value],
) -> Result<Vec<Message>, RenderError> {
    let mut out = Vec::with_capacity(1 + demos.len() * 2);
    out.push(Message::system(render_system_prompt(
        signature,
        instructions,
    )));

    for demo in demos {
        let (demo_in, demo_out) = split_demo(demo);
        out.push(Message::user(render_user_turn(signature, &demo_in)?));
        out.push(Message::assistant(render_assistant_turn(
            signature, &demo_out,
        )));
    }

    Ok(out)
}

pub(crate) fn render_structured_chat_prefix(
    signature: &Signature,
    instructions: &str,
    demos: &[Value],
) -> Result<Vec<Message>, RenderError> {
    let mut out = Vec::with_capacity(1 + demos.len() * 2);
    out.push(Message::system(render_structured_system_prompt(
        signature,
        instructions,
    )));

    for demo in demos {
        let (demo_in, demo_out) = split_demo(demo);
        out.push(Message::user(render_user_turn(signature, &demo_in)?));
        out.push(Message::assistant(render_assistant_turn(
            signature, &demo_out,
        )));
    }

    Ok(out)
}

fn render_system_prompt(signature: &Signature, instructions: &str) -> String {
    let mut s = String::new();

    // Task docstring (from the signature) takes precedence over
    // the instructions argument, matching DSPy. Bundle instructions
    // append after.
    if let Some(doc) = &signature.doc {
        if !doc.is_empty() {
            s.push_str(doc.trim());
            s.push_str("\n\n");
        }
    }
    if !instructions.is_empty() {
        s.push_str(instructions.trim());
        s.push_str("\n\n");
    }

    s.push_str("Your input fields are:\n");
    for f in &signature.inputs {
        s.push_str(&format!(
            "- `{}` ({}){}\n",
            f.name,
            type_name(&f.ty),
            doc_suffix(f)
        ));
    }
    s.push_str("\nYour output fields are:\n");
    for f in &signature.outputs {
        s.push_str(&format!(
            "- `{}` ({}){}\n",
            f.name,
            type_name(&f.ty),
            doc_suffix(f)
        ));
    }

    s.push_str("\nAll interactions will be structured using the following format:\n\n");
    for f in &signature.inputs {
        s.push_str(&format!("[[ ## {} ## ]]\n{{{}}}\n\n", f.name, f.name));
    }
    for f in &signature.outputs {
        s.push_str(&format!("[[ ## {} ## ]]\n{{{}}}\n\n", f.name, f.name));
    }
    s.push_str("[[ ## completed ## ]]\n");

    s
}

fn render_structured_system_prompt(signature: &Signature, instructions: &str) -> String {
    let mut s = String::new();

    if let Some(doc) = &signature.doc {
        if !doc.is_empty() {
            s.push_str(doc.trim());
            s.push_str("\n\n");
        }
    }
    if !instructions.is_empty() {
        s.push_str(instructions.trim());
        s.push_str("\n\n");
    }

    s.push_str(
        "Conversation history arrives as normal chat messages. Treat the most recent user turn as the current task, and use any earlier user, assistant, or tool turns as authoritative context.\n\n",
    );

    s.push_str("Your output fields are:\n");
    for f in &signature.outputs {
        s.push_str(&format!(
            "- `{}` ({}){}\n",
            f.name,
            type_name(&f.ty),
            doc_suffix(f)
        ));
    }

    s.push_str("\nRespond using the following format:\n\n");
    for f in &signature.outputs {
        s.push_str(&format!("[[ ## {} ## ]]\n{{{}}}\n\n", f.name, f.name));
    }
    s.push_str("[[ ## completed ## ]]\n");

    s
}

fn doc_suffix(f: &Field) -> String {
    match &f.doc {
        Some(d) if !d.is_empty() => format!(": {}", d),
        _ => String::new(),
    }
}

fn type_name(ty: &FieldType) -> String {
    match ty {
        FieldType::String => "str".into(),
        FieldType::Bool => "bool".into(),
        FieldType::Enum { values } => format!("Literal[{}]", values.join(", ")),
        FieldType::List { inner } => format!("list[{}]", type_name(inner)),
        FieldType::Optional { inner } => format!("Optional[{}]", type_name(inner)),
    }
}

fn render_user_turn(signature: &Signature, inputs: &Value) -> Result<String, RenderError> {
    let mut s = String::new();
    for f in &signature.inputs {
        s.push_str(&format!("[[ ## {} ## ]]\n", f.name));
        let raw = inputs
            .get(&f.name)
            .ok_or_else(|| RenderError::MissingInput {
                name: f.name.clone(),
            })?;
        s.push_str(&stringify_value(raw));
        s.push_str("\n\n");
    }
    // Prompt-continuation hint: ask the model to emit output-field
    // headers next. Matches DSPy.
    s.push_str("Respond with the output fields as specified, ending with [[ ## completed ## ]].\n");
    Ok(s)
}

fn render_assistant_turn(signature: &Signature, outputs: &Value) -> String {
    let mut s = String::new();
    for f in &signature.outputs {
        s.push_str(&format!("[[ ## {} ## ]]\n", f.name));
        let raw = outputs.get(&f.name).unwrap_or(&Value::Null);
        s.push_str(&stringify_value(raw));
        s.push_str("\n\n");
    }
    s.push_str("[[ ## completed ## ]]\n");
    s
}

fn split_demo(demo: &Value) -> (Value, Value) {
    let inputs = demo
        .get("inputs")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));
    let outputs = demo
        .get("outputs")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));
    (inputs, outputs)
}

fn stringify_value(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => {
            if *b {
                "true".into()
            } else {
                "false".into()
            }
        }
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Array(_) | Value::Object(_) => v.to_string(),
    }
}

/// Find every `[[ ## name ## ]]` delimiter in a response string.
/// Returns `(name, header_start_idx, header_end_idx)` triples.
fn find_delimiters(s: &str) -> Vec<(String, usize, usize)> {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 5 < bytes.len() {
        if &bytes[i..i + 3] == b"[[ " && &bytes[i + 3..i + 6] == b"## " {
            // Scan forward for ` ## ]]` closer.
            if let Some(end_rel) = find_subslice(&bytes[i + 6..], b" ## ]]") {
                let name_start = i + 6;
                let name_end = i + 6 + end_rel;
                let header_end = name_end + b" ## ]]".len();
                if let Ok(name) = core::str::from_utf8(&bytes[name_start..name_end]) {
                    out.push((name.trim().to_string(), i, header_end));
                }
                i = header_end;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn coerce(ty: &FieldType, raw: &str, name: &str) -> Result<Value, ParseError> {
    let trimmed = raw.trim();
    match ty {
        FieldType::String => Ok(Value::String(trimmed.to_string())),
        FieldType::Bool => match trimmed.to_lowercase().as_str() {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            other => Err(ParseError::BadType {
                field: name.into(),
                want: "bool".into(),
                got: other.into(),
            }),
        },
        FieldType::Enum { values } => {
            if values.iter().any(|v| v == trimmed) {
                Ok(Value::String(trimmed.to_string()))
            } else {
                Err(ParseError::BadType {
                    field: name.into(),
                    want: format!("one of {:?}", values),
                    got: trimmed.into(),
                })
            }
        }
        FieldType::List { inner: _ } => {
            // List fields are expected as JSON arrays; parse lazily.
            // If the model emitted comma-separated items instead, we'd
            // need a smarter pass — defer until we see it fail in practice.
            serde_json::from_str::<Value>(trimmed).map_err(|e| ParseError::BadType {
                field: name.into(),
                want: "list as JSON array".into(),
                got: format!("{} ({})", trimmed, e),
            })
        }
        FieldType::Optional { inner } => {
            if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("null") {
                Ok(Value::Null)
            } else {
                coerce(inner, trimmed, name)
            }
        }
    }
}

// ========================================================================
// JsonAdapter — strict JSON object in/out. Deferred implementation.
// ========================================================================

#[derive(Debug, Default)]
pub struct JsonAdapter;

impl Adapter for JsonAdapter {
    fn render(
        &self,
        _s: &Signature,
        _i: &str,
        _d: &[Value],
        _in: &Value,
    ) -> Result<Vec<Message>, RenderError> {
        Err(RenderError::BadInputShape {
            name: "n/a".into(),
            reason: "JsonAdapter not yet implemented".into(),
        })
    }
    fn parse(&self, _s: &Signature, _response: &str) -> Result<Value, ParseError> {
        Err(ParseError::Other("JsonAdapter not yet implemented".into()))
    }
}

// ========================================================================
// Tests
// ========================================================================

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::*;
    use crate::signature::Field;

    fn demo_sig() -> Signature {
        Signature {
            name: "Classify".into(),
            doc: Some("Classify the query into an intent.".into()),
            inputs: vec![Field {
                name: "query".into(),
                ty: FieldType::String,
                doc: Some("Raw user query.".into()),
            }],
            outputs: vec![Field {
                name: "intent".into(),
                ty: FieldType::Enum {
                    values: vec!["search".into(), "chat".into(), "tool".into()],
                },
                doc: None,
            }],
        }
    }

    #[test]
    fn render_emits_system_demos_and_user() {
        let adapter = ChatAdapter;
        let sig = demo_sig();
        let demo = serde_json::json!({
            "inputs":  { "query": "hi there" },
            "outputs": { "intent": "chat" }
        });
        let inputs = serde_json::json!({ "query": "what's the weather in Melbourne" });

        let msgs = adapter
            .render(&sig, "Be precise.", &[demo], &inputs)
            .unwrap();
        // system, demo_user, demo_asst, current_user
        assert_eq!(msgs.len(), 4);
        assert_eq!(msgs[0].role, "system");
        assert!(
            msgs[0]
                .content
                .contains("Classify the query into an intent.")
        );
        assert!(msgs[0].content.contains("[[ ## query ## ]]"));
        assert!(msgs[0].content.contains("[[ ## intent ## ]]"));
        assert!(msgs[0].content.contains("[[ ## completed ## ]]"));

        assert_eq!(msgs[1].role, "user");
        assert!(msgs[1].content.contains("hi there"));
        assert_eq!(msgs[2].role, "assistant");
        assert!(msgs[2].content.contains("chat"));
        assert!(msgs[2].content.ends_with("[[ ## completed ## ]]\n"));

        assert_eq!(msgs[3].role, "user");
        assert!(msgs[3].content.contains("what's the weather"));
    }

    #[test]
    fn parse_happy_path() {
        let adapter = ChatAdapter;
        let sig = demo_sig();
        let resp = "\
[[ ## intent ## ]]
search

[[ ## completed ## ]]
";
        let out = adapter.parse(&sig, resp).unwrap();
        assert_eq!(out, serde_json::json!({ "intent": "search" }));
    }

    #[test]
    fn parse_missing_terminator_fails() {
        let adapter = ChatAdapter;
        let sig = demo_sig();
        let resp = "[[ ## intent ## ]]\nsearch\n";
        let err = adapter.parse(&sig, resp).unwrap_err();
        assert!(matches!(err, ParseError::NoTerminator));
    }

    #[test]
    fn parse_missing_field_fails() {
        let adapter = ChatAdapter;
        let sig = demo_sig();
        let resp = "[[ ## other ## ]]\nhello\n\n[[ ## completed ## ]]";
        let err = adapter.parse(&sig, resp).unwrap_err();
        assert!(matches!(err, ParseError::MissingField(_)));
    }

    #[test]
    fn parse_enum_validation() {
        let adapter = ChatAdapter;
        let sig = demo_sig();
        let resp = "[[ ## intent ## ]]\nnot-a-real-intent\n\n[[ ## completed ## ]]";
        let err = adapter.parse(&sig, resp).unwrap_err();
        assert!(matches!(err, ParseError::BadType { .. }));
    }

    #[test]
    fn parse_bool_roundtrip() {
        let adapter = ChatAdapter;
        let sig = Signature {
            name: "Toxic".into(),
            doc: None,
            inputs: vec![Field {
                name: "comment".into(),
                ty: FieldType::String,
                doc: None,
            }],
            outputs: vec![Field {
                name: "toxic".into(),
                ty: FieldType::Bool,
                doc: None,
            }],
        };
        let resp = "[[ ## toxic ## ]]\nfalse\n\n[[ ## completed ## ]]";
        let out = adapter.parse(&sig, resp).unwrap();
        assert_eq!(out, serde_json::json!({ "toxic": false }));
    }

    #[test]
    fn render_parse_roundtrip() {
        // Render a fake assistant turn from known outputs, then parse
        // the rendered text back and expect the same outputs.
        let adapter = ChatAdapter;
        let sig = demo_sig();
        let outputs = serde_json::json!({ "intent": "tool" });
        let rendered = render_assistant_turn(&sig, &outputs);
        let parsed = adapter.parse(&sig, &rendered).unwrap();
        assert_eq!(parsed, outputs);
    }
}
