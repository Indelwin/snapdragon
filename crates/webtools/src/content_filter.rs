//! BM25-based markdown chunking and ranking.
//!
//! Pure port of the Hermes `content_filter` module with PyO3 removed and a
//! wasm JSON dispatcher added.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;

const DEFAULT_MAX_CHUNKS: usize = 8;
const DEFAULT_MIN_CHARS: usize = 30;
const K1: f64 = 1.5;
const B: f64 = 0.75;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Chunk {
    pub index: usize,
    pub text: String,
    pub token_count: usize,
    pub score: f64,
}

pub fn chunk_and_filter(
    markdown: &str,
    query: Option<&str>,
    max_chunks: Option<usize>,
    min_chars: Option<usize>,
) -> Vec<Chunk> {
    let max_chunks = max_chunks.unwrap_or(DEFAULT_MAX_CHUNKS);
    let min_chars = min_chars.unwrap_or(DEFAULT_MIN_CHARS);

    let mut chunks: Vec<Chunk> = split_paragraphs(markdown)
        .into_iter()
        .map(|text| normalize_ws(&text))
        .filter(|text| text.len() >= min_chars)
        .enumerate()
        .map(|(idx, text)| Chunk {
            token_count: tokenize(&text).len(),
            index: idx + 1,
            text,
            score: 0.0,
        })
        .collect();

    let q = query.map(normalize_ws).unwrap_or_default();
    if !q.is_empty() && !chunks.is_empty() {
        rank_bm25(&mut chunks, &q);
    }

    chunks.truncate(max_chunks);
    chunks
}

pub fn best_chunk(markdown: &str, query: Option<&str>) -> Option<Chunk> {
    chunk_and_filter(markdown, query, Some(1), None).pop()
}

fn rank_bm25(chunks: &mut [Chunk], query: &str) {
    let q_tokens = tokenize(query);
    let docs: Vec<Vec<String>> = chunks.iter().map(|c| tokenize(&c.text)).collect();
    let n_docs = docs.len().max(1);

    let mut df: HashMap<String, usize> = HashMap::new();
    for doc_tokens in &docs {
        let unique: std::collections::HashSet<&str> =
            doc_tokens.iter().map(String::as_str).collect();
        for token in unique {
            *df.entry(token.to_string()).or_insert(0) += 1;
        }
    }

    let total_len: usize = docs.iter().map(Vec::len).sum();
    let avgdl = (total_len as f64) / (n_docs as f64).max(1.0);

    for (chunk, doc_tokens) in chunks.iter_mut().zip(docs.iter()) {
        let dl = doc_tokens.len().max(1) as f64;
        let tf = term_freq(doc_tokens);
        let mut score = 0.0;
        for term in &q_tokens {
            let f = *tf.get(term.as_str()).unwrap_or(&0) as f64;
            if f == 0.0 {
                continue;
            }
            let dft = *df.get(term.as_str()).unwrap_or(&0) as f64;
            let idf = ((n_docs as f64 - dft + 0.5) / (dft + 0.5) + 1.0).ln();
            let denom = f + K1 * (1.0 - B + B * dl / avgdl.max(1.0));
            score += idf * (f * (K1 + 1.0)) / denom;
        }
        chunk.score = (score * 1_000_000.0).round() / 1_000_000.0;
    }

    chunks.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

fn split_paragraphs(text: &str) -> Vec<String> {
    regex::Regex::new(r"\n\s*\n+")
        .expect("split regex")
        .split(text)
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .collect()
}

fn tokenize(text: &str) -> Vec<String> {
    let lowered = text.to_lowercase();
    let cleaned = regex::Regex::new(r"[^\p{L}\p{N}\s]")
        .expect("token regex")
        .replace_all(&lowered, " ")
        .into_owned();
    cleaned.split_whitespace().map(str::to_string).collect()
}

fn term_freq(tokens: &[String]) -> HashMap<&str, usize> {
    let mut tf = HashMap::new();
    for token in tokens {
        *tf.entry(token.as_str()).or_insert(0) += 1;
    }
    tf
}

fn normalize_ws(text: &str) -> String {
    regex::Regex::new(r"\s+")
        .expect("ws regex")
        .replace_all(text, " ")
        .trim()
        .to_string()
}

pub fn dispatch(req: Value) -> Value {
    let op = match req.get("op").and_then(Value::as_str) {
        Some(op) => op,
        None => return err("missing op"),
    };
    let args = req.get("args").cloned().unwrap_or(Value::Null);
    match op {
        "chunk" | "chunk_and_filter" => {
            let Some(markdown) = args.get("markdown").and_then(Value::as_str) else {
                return err("chunk: missing markdown");
            };
            let query = args.get("query").and_then(Value::as_str);
            let max_chunks = args
                .get("max_chunks")
                .and_then(Value::as_u64)
                .map(|n| n as usize);
            let min_chars = args
                .get("min_chars")
                .and_then(Value::as_u64)
                .map(|n| n as usize);
            ok(json!(chunk_and_filter(
                markdown, query, max_chunks, min_chars
            )))
        }
        "best" | "best_chunk" => {
            let Some(markdown) = args.get("markdown").and_then(Value::as_str) else {
                return err("best: missing markdown");
            };
            let query = args.get("query").and_then(Value::as_str);
            ok(json!(best_chunk(markdown, query)))
        }
        other => err(&format!("unknown op: {other}")),
    }
}

fn ok(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}
fn err(reason: &str) -> Value {
    json!({ "ok": false, "error": reason })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_and_filter_no_query() {
        let md = "First paragraph here.\n\nSecond paragraph with more text.\n\nThird one.";
        let chunks = chunk_and_filter(md, None, None, Some(5));
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].score, 0.0);
    }

    #[test]
    fn chunk_and_filter_with_query() {
        let md = "Rust is a systems programming language.\n\nPython is great for data science.\n\nJava is used in enterprise applications.";
        let chunks = chunk_and_filter(md, Some("systems programming"), None, Some(5));
        assert!(chunks[0].text.contains("Rust"));
        assert!(chunks[0].score > 0.0);
    }

    #[test]
    fn best_chunk_selects_match() {
        let md = "Paragraph about cats with enough words.\n\nParagraph about dogs with enough words.\n\nParagraph about fish with enough words.";
        let best = best_chunk(md, Some("dogs")).unwrap();
        assert!(best.text.contains("dogs"));
    }

    #[test]
    fn dispatcher_round_trip() {
        let resp = dispatch(
            json!({"op":"best", "args":{"markdown":"Cats are independent animals.\n\nDogs are loyal companion animals.", "query":"dogs", "min_chars": 5}}),
        );
        assert_eq!(resp["ok"], json!(true));
        assert!(resp["value"]["text"].as_str().unwrap().contains("Dogs"));
    }
}
