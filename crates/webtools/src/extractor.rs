//! HTML extraction public API.

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

use crate::extractor_clean::strip_never_render;
use crate::extractor_dispatch::dispatch_extractor;
use crate::extractor_markdown::extract_body_markdown;
use crate::extractor_metadata::{extract_meta_description, extract_title};
use crate::extractor_metadata_budget::MetadataBudget;
use crate::extractor_metadata_links::extract_links;
use crate::extractor_metadata_media::{extract_headings, extract_images};
use crate::extractor_text::{element_text, normalize_ws};

pub(crate) const MAX_HTML_BYTES: usize = 2_000_000;
pub(crate) const MAX_MARKDOWN_CHARS: usize = 250_000;
const MAX_SELECTOR_BYTES: usize = 4_096;
const MAX_SELECTOR_NODES: usize = 256;
const MAX_SELECTOR_RESULT_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExtractionResult {
    pub title: String,
    pub description: String,
    pub markdown: String,
    pub text_length: usize,
    pub links: Vec<LinkInfo>,
    pub images: Vec<ImageInfo>,
    pub headings: Vec<HeadingInfo>,
    pub truncation: ExtractionTruncation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExtractionTruncation {
    pub markdown: bool,
    pub metadata: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkInfo {
    pub href: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageInfo {
    pub src: String,
    pub alt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadingInfo {
    pub level: u8,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SelectorExtractionResult {
    pub matched_nodes: usize,
    pub texts: Vec<String>,
    pub html_fragments: Vec<String>,
}

pub fn html_to_markdown(html: &str, max_chars: usize) -> Result<ExtractionResult, String> {
    validate_html(html)?;
    if max_chars == 0 || max_chars > MAX_MARKDOWN_CHARS {
        return Err(format!(
            "extract: max_chars budget must be between 1 and {MAX_MARKDOWN_CHARS}"
        ));
    }
    let cleaned = strip_never_render(html);
    let document = Html::parse_document(&cleaned);
    let mut metadata_budget = MetadataBudget::new();
    let title = extract_title(&document, &mut metadata_budget);
    let (markdown, markdown_truncated) = extract_body_markdown(&document, &title, max_chars);
    let description = extract_meta_description(&document, &mut metadata_budget);
    let links = extract_links(&document, &mut metadata_budget);
    let images = extract_images(&document, &mut metadata_budget);
    let headings = extract_headings(&document, &mut metadata_budget);
    Ok(ExtractionResult {
        description,
        text_length: markdown.len(),
        links,
        images,
        headings,
        title,
        markdown,
        truncation: ExtractionTruncation {
            markdown: markdown_truncated,
            metadata: metadata_budget.truncated(),
        },
    })
}

pub fn extract_by_selector(
    html: &str,
    selector_str: &str,
) -> Result<SelectorExtractionResult, String> {
    validate_html(html)?;
    if selector_str.len() > MAX_SELECTOR_BYTES {
        return Err(format!(
            "selector bytes budget exceeded: {} > {MAX_SELECTOR_BYTES}",
            selector_str.len()
        ));
    }
    let cleaned = strip_never_render(html);
    let document = Html::parse_document(&cleaned);
    let selector = Selector::parse(selector_str)
        .map_err(|e| format!("Invalid selector '{}': {:?}", selector_str, e))?;
    let mut texts = Vec::new();
    let mut html_fragments = Vec::new();
    let mut result_bytes = 0;
    for element in document.select(&selector) {
        let text = normalize_ws(&element_text(&element));
        if text.is_empty() {
            continue;
        }
        if texts.len() >= MAX_SELECTOR_NODES {
            return Err(format!(
                "selector node budget exceeded: more than {MAX_SELECTOR_NODES} matches"
            ));
        }
        let fragment = element.html();
        result_bytes += text.len() + fragment.len();
        if result_bytes > MAX_SELECTOR_RESULT_BYTES {
            return Err(format!(
                "selector result bytes budget exceeded: {result_bytes} > {MAX_SELECTOR_RESULT_BYTES}"
            ));
        }
        texts.push(text);
        html_fragments.push(fragment);
    }
    Ok(SelectorExtractionResult {
        matched_nodes: texts.len(),
        texts,
        html_fragments,
    })
}

fn validate_html(html: &str) -> Result<(), String> {
    if html.len() > MAX_HTML_BYTES {
        Err(format!(
            "HTML input bytes budget exceeded: {} > {MAX_HTML_BYTES}",
            html.len()
        ))
    } else {
        Ok(())
    }
}

pub fn detect_js_only(html: &str) -> Result<bool, String> {
    validate_html(html)?;
    let cleaned = strip_never_render(html);
    let document = Html::parse_document(&cleaned);
    Ok(crate::extractor_spa::detect_js_shell(&document, html))
}

pub fn dispatch(req: serde_json::Value) -> serde_json::Value {
    dispatch_extractor(req)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const HTML: &str = r#"
      <html><head><title>Example Title</title><meta name="description" content="Example desc"></head>
      <body><nav>Skip me</nav><main><h1>Example Title</h1><p>Hello <b>world</b>.</p><a href="/next">Next</a><img src="/i.png" alt="I"></main></body></html>
    "#;

    #[test]
    fn extracts_markdown_and_metadata() {
        let r = html_to_markdown(HTML, 10_000).unwrap();
        assert_eq!(r.title, "Example Title");
        assert_eq!(r.description, "Example desc");
        assert!(r.markdown.contains("# Example Title"));
        assert!(r.markdown.contains("Hello world ."));
        assert_eq!(r.links[0].href, "/next");
        assert_eq!(r.images[0].alt, "I");
    }

    #[test]
    fn selector_extracts_text_and_html() {
        let r = extract_by_selector(HTML, "main p").unwrap();
        assert_eq!(r.matched_nodes, 1);
        assert_eq!(r.texts[0], "Hello world .");
        assert!(r.html_fragments[0].contains("<p>"));
    }

    #[test]
    fn detects_js_only_spa_shell() {
        let html = "<html><body><div id='root'></div><script src='/a.js'></script></body></html>";
        assert!(detect_js_only(html).unwrap());
    }

    #[test]
    fn dispatcher_round_trip() {
        let resp = dispatch(json!({"op":"extract", "args":{"html":HTML}}));
        assert_eq!(resp["ok"], json!(true));
        assert_eq!(resp["value"]["title"], json!("Example Title"));
    }

    #[test]
    fn reports_bounded_markdown_and_metadata() {
        let markdown = html_to_markdown(
            &format!("<main><p>{}</p></main>", "content ".repeat(100)),
            80,
        )
        .unwrap();
        assert!(markdown.truncation.markdown);
        assert!(markdown.markdown.chars().count() <= 80);

        let links = (0..1_100)
            .map(|index| format!(r#"<a href="/{index}">link</a>"#))
            .collect::<String>();
        let metadata = html_to_markdown(&format!("<main>{links}</main>"), 10_000).unwrap();
        assert!(metadata.truncation.metadata);
        assert_eq!(metadata.links.len(), MAX_LINKS_FOR_TEST);
    }

    #[test]
    fn rejects_html_and_selector_results_over_budget() {
        assert!(html_to_markdown(&"x".repeat(MAX_HTML_BYTES + 1), 100).is_err());
        let nodes = (0..=MAX_SELECTOR_NODES)
            .map(|_| "<p>content</p>")
            .collect::<String>();
        assert!(extract_by_selector(&nodes, "p").is_err());
    }

    const MAX_LINKS_FOR_TEST: usize = 1_024;
}
