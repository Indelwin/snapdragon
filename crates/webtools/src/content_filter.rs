//! BM25-based markdown chunking and ranking.
//!
//! Pure port of the Hermes `content_filter` module with PyO3 removed and a
//! wasm JSON dispatcher added.

use serde::{Deserialize, Serialize};

use crate::content_filter_rank::{normalize_ws, rank_bm25, tokenize};

pub use crate::content_filter_dispatch::dispatch;

const DEFAULT_MAX_CHUNKS: usize = 8;
const DEFAULT_MIN_CHARS: usize = 30;
const MAX_INPUT_BYTES: usize = 1_000_000;
const MAX_QUERY_BYTES: usize = 8_192;
pub(crate) const MAX_CHUNKS: usize = 64;
pub(crate) const MAX_MIN_CHARS: usize = 100_000;
const MAX_CANDIDATE_CHUNKS: usize = 4_096;
const MAX_TOTAL_TOKENS: usize = 200_000;

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
) -> Result<Vec<Chunk>, String> {
    validate_filter_input(markdown, query)?;
    let max_chunks = max_chunks.unwrap_or(DEFAULT_MAX_CHUNKS);
    let min_chars = min_chars.unwrap_or(DEFAULT_MIN_CHARS);
    if max_chunks > MAX_CHUNKS {
        return Err(format!(
            "filtered chunks budget exceeded: {max_chunks} > {MAX_CHUNKS}"
        ));
    }
    if min_chars == 0 || min_chars > MAX_MIN_CHARS {
        return Err(format!(
            "minimum chunk characters budget must be between 1 and {MAX_MIN_CHARS}"
        ));
    }
    if max_chunks == 0 {
        return Ok(Vec::new());
    }

    let mut chunks = bounded_chunks(markdown, min_chars)?;

    let q = query.map(normalize_ws).unwrap_or_default();
    if !q.is_empty() {
        rank_bm25(&mut chunks, &q);
    }

    chunks.truncate(max_chunks);
    Ok(chunks)
}

pub fn best_chunk(markdown: &str, query: Option<&str>) -> Result<Option<Chunk>, String> {
    Ok(chunk_and_filter(markdown, query, Some(1), None)?.pop())
}

fn bounded_chunks(markdown: &str, min_chars: usize) -> Result<Vec<Chunk>, String> {
    let split_regex = regex::Regex::new(r"\n\s*\n+").expect("split regex");
    let mut chunks = Vec::new();
    let mut total_tokens = 0;
    for paragraph in split_regex.split(markdown).filter(|s| !s.trim().is_empty()) {
        let text = normalize_ws(paragraph);
        if text.len() < min_chars {
            continue;
        }
        if chunks.len() >= MAX_CANDIDATE_CHUNKS {
            return Err(format!(
                "content filter candidate budget exceeded: more than {MAX_CANDIDATE_CHUNKS} chunks"
            ));
        }
        let token_count = tokenize(&text).len();
        total_tokens += token_count;
        if total_tokens > MAX_TOTAL_TOKENS {
            return Err(format!(
                "content filter token budget exceeded: {total_tokens} > {MAX_TOTAL_TOKENS}"
            ));
        }
        chunks.push(Chunk {
            token_count,
            index: chunks.len() + 1,
            text,
            score: 0.0,
        });
    }
    Ok(chunks)
}

fn validate_filter_input(markdown: &str, query: Option<&str>) -> Result<(), String> {
    if markdown.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "content filter input bytes budget exceeded: {} > {MAX_INPUT_BYTES}",
            markdown.len()
        ));
    }
    if let Some(query) = query
        && query.len() > MAX_QUERY_BYTES
    {
        return Err(format!(
            "content filter query bytes budget exceeded: {} > {MAX_QUERY_BYTES}",
            query.len()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn chunk_and_filter_no_query() {
        let md = "First paragraph here.\n\nSecond paragraph with more text.\n\nThird one.";
        let chunks = chunk_and_filter(md, None, None, Some(5)).unwrap();
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].score, 0.0);
    }

    #[test]
    fn chunk_and_filter_with_query() {
        let md = "Rust is a systems programming language.\n\nPython is great for data science.\n\nJava is used in enterprise applications.";
        let chunks = chunk_and_filter(md, Some("systems programming"), None, Some(5)).unwrap();
        assert!(chunks[0].text.contains("Rust"));
        assert!(chunks[0].score > 0.0);
    }

    #[test]
    fn best_chunk_selects_match() {
        let md = "Paragraph about cats with enough words.\n\nParagraph about dogs with enough words.\n\nParagraph about fish with enough words.";
        let best = best_chunk(md, Some("dogs")).unwrap().unwrap();
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

    #[test]
    fn rejects_filter_inputs_and_intermediates_over_budget() {
        assert!(chunk_and_filter(&"x".repeat(MAX_INPUT_BYTES + 1), None, None, None).is_err());
        assert!(chunk_and_filter("bounded", None, Some(MAX_CHUNKS + 1), None).is_err());
        let paragraphs = (0..=MAX_CANDIDATE_CHUNKS)
            .map(|_| "a")
            .collect::<Vec<_>>()
            .join("\n\n");
        assert!(chunk_and_filter(&paragraphs, None, None, Some(1)).is_err());
    }
}
