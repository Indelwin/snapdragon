use serde_json::{Value, json};

use crate::url_canon::{canonicalize, cleanup_url, host, normalize_input, resolve};
use crate::url_match::pattern_match;
use crate::url_parts::same_or_subdomain;

pub(crate) fn dispatch_url_util(req: Value) -> Value {
    let op = match req.get("op").and_then(Value::as_str) {
        Some(op) => op,
        None => return err("missing op"),
    };
    let args = req.get("args").cloned().unwrap_or(Value::Null);
    match op {
        "normalize" => unary(args, "raw", normalize_input, "normalize: missing raw"),
        "canonicalize" => unary(args, "raw", canonicalize, "canonicalize: missing raw"),
        "host" => unary_string(args, "url", host, "host: missing url"),
        "cleanup" => unary_string(args, "raw", cleanup_url, "cleanup: missing raw"),
        "resolve" => binary(
            args,
            "base",
            "href",
            resolve,
            "resolve: missing base or href",
        ),
        "same_or_subdomain" => binary_bool(args, "host", "root", same_or_subdomain),
        "pattern_match" => binary_bool(args, "url", "pattern", pattern_match),
        other => err(&format!("unknown op: {other}")),
    }
}

fn unary(args: Value, key: &str, f: fn(&str) -> Option<String>, missing: &str) -> Value {
    match args.get(key).and_then(Value::as_str) {
        Some(value) => ok(json!(f(value))),
        None => err(missing),
    }
}

fn unary_string(args: Value, key: &str, f: fn(&str) -> String, missing: &str) -> Value {
    match args.get(key).and_then(Value::as_str) {
        Some(value) => ok(json!(f(value))),
        None => err(missing),
    }
}

fn binary(
    args: Value,
    left_key: &str,
    right_key: &str,
    f: fn(&str, &str) -> Option<String>,
    missing: &str,
) -> Value {
    match pair(&args, left_key, right_key) {
        Some((left, right)) => ok(json!(f(left, right))),
        None => err(missing),
    }
}

fn binary_bool(args: Value, left_key: &str, right_key: &str, f: fn(&str, &str) -> bool) -> Value {
    match pair(&args, left_key, right_key) {
        Some((left, right)) => ok(json!(f(left, right))),
        None => err(&format!(
            "{}: missing {} or {}",
            left_key, left_key, right_key
        )),
    }
}

fn pair<'a>(args: &'a Value, left_key: &str, right_key: &str) -> Option<(&'a str, &'a str)> {
    let left = args.get(left_key).and_then(Value::as_str)?;
    let right = args.get(right_key).and_then(Value::as_str)?;
    Some((left, right))
}

fn ok(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

fn err(reason: &str) -> Value {
    json!({ "ok": false, "error": reason })
}
