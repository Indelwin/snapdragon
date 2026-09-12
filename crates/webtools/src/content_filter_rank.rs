use std::collections::{HashMap, HashSet};

use crate::content_filter::Chunk;

const K1: f64 = 1.5;
const B: f64 = 0.75;

pub(crate) fn rank_bm25(chunks: &mut [Chunk], query: &str) {
    let query_tokens = tokenize(query);
    let documents: Vec<Vec<String>> = chunks.iter().map(|chunk| tokenize(&chunk.text)).collect();
    let document_count = documents.len().max(1);
    let document_frequencies = document_frequencies(&documents);
    let total_length: usize = documents.iter().map(Vec::len).sum();
    let average_length = (total_length as f64) / (document_count as f64).max(1.0);

    for (chunk, tokens) in chunks.iter_mut().zip(documents.iter()) {
        chunk.score = score_document(
            tokens,
            &query_tokens,
            &document_frequencies,
            document_count,
            average_length,
        );
    }
    chunks.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

fn document_frequencies(documents: &[Vec<String>]) -> HashMap<String, usize> {
    let mut frequencies = HashMap::new();
    for tokens in documents {
        let unique: HashSet<&str> = tokens.iter().map(String::as_str).collect();
        for token in unique {
            *frequencies.entry(token.to_string()).or_insert(0) += 1;
        }
    }
    frequencies
}

fn score_document(
    tokens: &[String],
    query: &[String],
    document_frequencies: &HashMap<String, usize>,
    document_count: usize,
    average_length: f64,
) -> f64 {
    let document_length = tokens.len().max(1) as f64;
    let term_frequencies = term_frequencies(tokens);
    let mut score = 0.0;
    for term in query {
        let frequency = *term_frequencies.get(term.as_str()).unwrap_or(&0) as f64;
        if frequency == 0.0 {
            continue;
        }
        let document_frequency = *document_frequencies.get(term).unwrap_or(&0) as f64;
        let inverse_frequency =
            ((document_count as f64 - document_frequency + 0.5) / (document_frequency + 0.5) + 1.0)
                .ln();
        let denominator =
            frequency + K1 * (1.0 - B + B * document_length / average_length.max(1.0));
        score += inverse_frequency * (frequency * (K1 + 1.0)) / denominator;
    }
    (score * 1_000_000.0).round() / 1_000_000.0
}

pub(crate) fn tokenize(text: &str) -> Vec<String> {
    let lowered = text.to_lowercase();
    let cleaned = regex::Regex::new(r"[^\p{L}\p{N}\s]")
        .expect("token regex")
        .replace_all(&lowered, " ")
        .into_owned();
    cleaned.split_whitespace().map(str::to_string).collect()
}

fn term_frequencies(tokens: &[String]) -> HashMap<&str, usize> {
    let mut frequencies = HashMap::new();
    for token in tokens {
        *frequencies.entry(token.as_str()).or_insert(0) += 1;
    }
    frequencies
}

pub(crate) fn normalize_ws(text: &str) -> String {
    regex::Regex::new(r"\s+")
        .expect("ws regex")
        .replace_all(text, " ")
        .trim()
        .to_string()
}
