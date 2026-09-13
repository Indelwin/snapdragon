use serde_json::{Value, json};

use crate::content_filter::{MAX_CHUNKS, MAX_MIN_CHARS, best_chunk, chunk_and_filter};

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
    let max_chunks = match optional_bounded_usize(args, "max_chunks", 0, MAX_CHUNKS) {
        Ok(value) => value,
        Err(error) => return err(&error),
    };
    let min_chars = match optional_bounded_usize(args, "min_chars", 1, MAX_MIN_CHARS) {
        Ok(value) => value,
        Err(error) => return err(&error),
    };
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

fn optional_bounded_usize(
    args: &Value,
    key: &str,
    minimum: usize,
    maximum: usize,
) -> Result<Option<usize>, String> {
    let Some(raw) = args.get(key) else {
        return Ok(None);
    };
    let Some(raw) = raw.as_u64() else {
        return Err(format!("{key} must be an unsigned integer"));
    };
    let value = usize::try_from(raw).map_err(|_| format!("{key} exceeds this target's usize"))?;
    if value < minimum || value > maximum {
        return Err(format!(
            "{key} budget must be between {minimum} and {maximum}"
        ));
    }
    Ok(Some(value))
}

fn ok(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

fn err(reason: &str) -> Value {
    json!({ "ok": false, "error": reason })
}

#[cfg(test)]
mod tests {
    use super::dispatch;
    use serde_json::json;

    #[test]
    fn direct_abi_rejects_numbers_that_cannot_fit_wasm_usize() {
        for key in ["max_chunks", "min_chars"] {
            let mut args = json!({ "markdown": "bounded content" });
            args[key] = json!(1_u64 << 32);
            let response = dispatch(json!({
                "op": "chunk",
                "args": args
            }));
            assert_eq!(response["ok"], false, "{key}");
            assert!(
                response["error"].as_str().unwrap().contains("budget"),
                "{key}"
            );
        }
    }

    #[test]
    fn direct_abi_rejects_non_integer_optional_limits() {
        let response = dispatch(json!({
            "op": "chunk",
            "args": { "markdown": "bounded content", "max_chunks": 1.5 }
        }));
        assert_eq!(response["ok"], false);
        assert!(
            response["error"]
                .as_str()
                .unwrap()
                .contains("unsigned integer")
        );
    }
}
