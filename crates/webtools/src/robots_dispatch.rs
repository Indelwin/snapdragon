use serde_json::{Value, json};

use crate::robots::{is_allowed, parse_sitemaps};

pub(crate) fn dispatch_robots(req: Value) -> Value {
    let op = match req.get("op").and_then(Value::as_str) {
        Some(op) => op,
        None => return err("missing op"),
    };
    let args = req.get("args").cloned().unwrap_or(Value::Null);
    match op {
        "check" => check(args),
        "sitemaps" => sitemaps(args),
        other => err(&format!("unknown op: {other}")),
    }
}

fn check(args: Value) -> Value {
    let body = args.get("body").and_then(Value::as_str).unwrap_or("");
    let user_agent = args
        .get("user_agent")
        .and_then(Value::as_str)
        .unwrap_or("SnapdragonCrawler/0.1");
    let Some(url) = args.get("url").and_then(Value::as_str) else {
        return err("check: missing url");
    };
    ok(json!(is_allowed(body, user_agent, url)))
}

fn sitemaps(args: Value) -> Value {
    let body = args.get("body").and_then(Value::as_str).unwrap_or("");
    ok(json!(parse_sitemaps(body)))
}

fn ok(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

fn err(reason: &str) -> Value {
    json!({ "ok": false, "error": reason })
}
