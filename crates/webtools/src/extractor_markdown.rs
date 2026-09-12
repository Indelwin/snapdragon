use scraper::{Html, Selector};

use crate::extractor_boilerplate::is_boilerplate_ancestor;
use crate::extractor_render::{append_markdown, container_to_markdown, tag_markdown};
use crate::extractor_text::{element_text, normalize_ws, truncate_str};

const CONTENT_SELECTORS: &[&str] = &[
    "article",
    "main",
    "[role='main']",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
    "#content",
    ".markdown-body",
    ".prose",
];

const BLOCK_SELECTORS: &str =
    "p, li, h1, h2, h3, h4, h5, h6, pre, code, blockquote, td, th, dt, dd, figcaption";

pub(crate) fn extract_body_markdown(doc: &Html, title: &str, max_chars: usize) -> (String, bool) {
    if let Some((markdown, content_truncated)) = content_container_markdown(doc, max_chars) {
        let (bounded, title_truncated) =
            truncate_str(&prepend_title_if_absent(title, &markdown), max_chars);
        return (bounded, content_truncated || title_truncated);
    }
    fallback_markdown(doc, title, max_chars)
}

fn content_container_markdown(doc: &Html, max_chars: usize) -> Option<(String, bool)> {
    CONTENT_SELECTORS.iter().find_map(|selector| {
        let sel = Selector::parse(selector).ok()?;
        let container = doc.select(&sel).next()?;
        let (markdown, truncated) = container_to_markdown(&container, max_chars);
        (markdown.len() > 100)
            .then_some(markdown)
            .map(|markdown| (markdown, truncated))
    })
}

fn fallback_markdown(doc: &Html, title: &str, max_chars: usize) -> (String, bool) {
    let Some(block_sel) = Selector::parse(BLOCK_SELECTORS).ok() else {
        return (String::new(), false);
    };
    let mut body = String::new();
    let mut body_chars = 0;
    let mut truncated = false;
    for paragraph in doc
        .select(&block_sel)
        .filter(|el| !is_boilerplate_ancestor(el))
        .filter_map(block_markdown)
    {
        if append_markdown(&mut body, &mut body_chars, &paragraph, max_chars) {
            truncated = true;
            break;
        }
    }
    let (output, title_truncated) = truncate_str(&prepend_title_if_absent(title, &body), max_chars);
    (output, truncated || title_truncated)
}

fn block_markdown(el: scraper::ElementRef) -> Option<String> {
    let text = normalize_ws(&element_text(&el));
    (!text.is_empty()).then(|| tag_markdown(el.value().name(), &text))
}

fn prepend_title_if_absent(title: &str, body: &str) -> String {
    let title = title.trim();
    if title.is_empty() || first_h1_matches(body, title) {
        body.to_string()
    } else {
        format!("# {}\n\n{}", title, body)
    }
}

fn first_h1_matches(body: &str, title: &str) -> bool {
    body.trim_start()
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("# "))
        .map(|h1| h1.trim().eq_ignore_ascii_case(title))
        .unwrap_or(false)
}
