//! HTML extraction public API.

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

use crate::extractor_clean::strip_never_render;
use crate::extractor_dispatch::dispatch_extractor;
use crate::extractor_markdown::extract_body_markdown;
use crate::extractor_metadata::{
    extract_headings, extract_images, extract_links, extract_meta_description, extract_title,
};
use crate::extractor_text::{element_text, normalize_ws};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExtractionResult {
    pub title: String,
    pub description: String,
    pub markdown: String,
    pub text_length: usize,
    pub links: Vec<LinkInfo>,
    pub images: Vec<ImageInfo>,
    pub headings: Vec<HeadingInfo>,
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

pub fn html_to_markdown(html: &str, max_chars: usize) -> ExtractionResult {
    let cleaned = strip_never_render(html);
    let document = Html::parse_document(&cleaned);
    let title = extract_title(&document);
    let markdown = extract_body_markdown(&document, &title, max_chars);
    ExtractionResult {
        description: extract_meta_description(&document),
        text_length: markdown.len(),
        links: extract_links(&document),
        images: extract_images(&document),
        headings: extract_headings(&document),
        title,
        markdown,
    }
}

pub fn extract_by_selector(
    html: &str,
    selector_str: &str,
) -> Result<SelectorExtractionResult, String> {
    let cleaned = strip_never_render(html);
    let document = Html::parse_document(&cleaned);
    let selector = Selector::parse(selector_str)
        .map_err(|e| format!("Invalid selector '{}': {:?}", selector_str, e))?;
    let matches = document.select(&selector).filter_map(|element| {
        let text = normalize_ws(&element_text(&element));
        (!text.is_empty()).then(|| (text, element.html()))
    });
    let (texts, html_fragments): (Vec<_>, Vec<_>) = matches.unzip();
    Ok(SelectorExtractionResult {
        matched_nodes: texts.len(),
        texts,
        html_fragments,
    })
}

pub fn detect_js_only(html: &str) -> bool {
    let cleaned = strip_never_render(html);
    let document = Html::parse_document(&cleaned);
    crate::extractor_spa::detect_js_shell(&document, html)
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
        let r = html_to_markdown(HTML, 10_000);
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
        assert!(detect_js_only(html));
    }

    #[test]
    fn dispatcher_round_trip() {
        let resp = dispatch(json!({"op":"extract", "args":{"html":HTML}}));
        assert_eq!(resp["ok"], json!(true));
        assert_eq!(resp["value"]["title"], json!("Example Title"));
    }
}
