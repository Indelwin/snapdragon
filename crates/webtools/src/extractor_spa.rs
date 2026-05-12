use scraper::{Html, Selector};

use crate::extractor_text::element_text;

pub(crate) fn detect_js_shell(document: &Html, raw_html: &str) -> bool {
    let body_text = body_text(document);
    let lower = raw_html.to_lowercase();
    let has_warning = lower.contains("you need to enable javascript")
        || lower.contains("javascript is required")
        || lower.contains("please enable javascript");
    let has_root = selector_exists(document, "#root, #app, #__next, #__nuxt, [data-reactroot]");
    let scripts = selector_count(&Html::parse_document(raw_html), "script[src]");
    (body_text.trim().len() < 200 && (has_root || has_warning))
        || (body_text.trim().len() < 100 && scripts > 5)
}

fn body_text(document: &Html) -> String {
    Selector::parse("body")
        .ok()
        .and_then(|sel| document.select(&sel).next().map(|el| element_text(&el)))
        .unwrap_or_default()
}

fn selector_exists(document: &Html, selector: &str) -> bool {
    Selector::parse(selector)
        .ok()
        .map(|sel| document.select(&sel).next().is_some())
        .unwrap_or(false)
}

fn selector_count(document: &Html, selector: &str) -> usize {
    Selector::parse(selector)
        .ok()
        .map(|sel| document.select(&sel).count())
        .unwrap_or(0)
}
