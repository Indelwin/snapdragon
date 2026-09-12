use serde_json::{Value, json};

use crate::content_filter::{best_chunk, chunk_and_filter};

pub fn dispatch(req: Value) -> Value {
    let op = match req.get("op").and_then(Value::as_str) {
        Some(op) => op,
        None => return err("missing op"),
    };
    let args = req.get("args").cloned().unwrap_or(Value::Null);
    match op {
        "chunk" | "chunk_and_filter" => dispatch_chunks(&args),
        "best" | "best_chunk" => dispatch_best(&args),
        other => err(&format!("unknown op: {other}")),
    }
}

fn dispatch_chunks(args: &Value) -> Value {
    let Some(markdown) = args.get("markdown").and_then(Value::as_str) else {
        return err("chunk: missing markdown");
    };
    let query = args.get("query").and_then(Value::as_str);
    let max_chunks = optional_usize(args, "max_chunks");
    let min_chars = optional_usize(args, "min_chars");
    match chunk_and_filter(markdown, query, max_chunks, min_chars) {
        Ok(value) => ok(json!(value)),
        Err(error) => err(&error),
    }
}

fn dispatch_best(args: &Value) -> Value {
    let Some(markdown) = args.get("markdown").and_then(Value::as_str) else {
        return err("best: missing markdown");
    };
    let query = args.get("query").and_then(Value::as_str);
    match best_chunk(markdown, query) {
        Ok(value) => ok(json!(value)),
        Err(error) => err(&error),
    }
}

fn optional_usize(args: &Value, key: &str) -> Option<usize> {
    args.get(key)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
}

fn ok(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

fn err(reason: &str) -> Value {
    json!({ "ok": false, "error": reason })
}
