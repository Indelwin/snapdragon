use serde_json::{Value, json};

use crate::extractor::{detect_js_only, extract_by_selector, html_to_markdown};

pub(crate) fn dispatch_extractor(req: Value) -> Value {
    let op = match req.get("op").and_then(Value::as_str) {
        Some(op) => op,
        None => return err("missing op"),
    };
    let args = req.get("args").cloned().unwrap_or(Value::Null);
    match op {
        "extract" | "html_to_markdown" => extract(args),
        "selector" | "extract_by_selector" => selector(args),
        "detect_js_only" => detect(args),
        other => err(&format!("unknown op: {other}")),
    }
}

fn extract(args: Value) -> Value {
    let Some(html) = args.get("html").and_then(Value::as_str) else {
        return err("extract: missing html");
    };
    let max_chars = args
        .get("max_chars")
        .and_then(Value::as_u64)
        .unwrap_or(50_000);
    let Ok(max_chars) = usize::try_from(max_chars) else {
        return err("extract: max_chars is too large");
    };
    match html_to_markdown(html, max_chars) {
        Ok(value) => ok(json!(value)),
        Err(error) => err(&error),
    }
}

fn selector(args: Value) -> Value {
    let Some(html) = args.get("html").and_then(Value::as_str) else {
        return err("selector: missing html");
    };
    let Some(selector) = args.get("selector").and_then(Value::as_str) else {
        return err("selector: missing selector");
    };
    match extract_by_selector(html, selector) {
        Ok(value) => ok(json!(value)),
        Err(error) => err(&error),
    }
}

fn detect(args: Value) -> Value {
    let Some(html) = args.get("html").and_then(Value::as_str) else {
        return err("detect_js_only: missing html");
    };
    match detect_js_only(html) {
        Ok(value) => ok(json!(value)),
        Err(error) => err(&error),
    }
}

fn ok(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

fn err(reason: &str) -> Value {
    json!({ "ok": false, "error": reason })
}
