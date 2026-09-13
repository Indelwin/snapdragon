use scraper::{Html, Selector};

use crate::extractor_metadata_budget::MetadataBudget;
use crate::extractor_text::{element_text, normalize_ws};

const MAX_TITLE_BYTES: usize = 8_192;
const MAX_DESCRIPTION_BYTES: usize = 32_768;

pub(crate) fn extract_title(doc: &Html, budget: &mut MetadataBudget) -> String {
    if let Some(title) = first_text(doc, "title") {
        if !title.is_empty() {
            return budget.take(&title, MAX_TITLE_BYTES);
        }
    }
    let title = first_attr(doc, "meta[property='og:title']", "content").unwrap_or_default();
    budget.take(&title, MAX_TITLE_BYTES)
}

pub(crate) fn extract_meta_description(doc: &Html, budget: &mut MetadataBudget) -> String {
    let description = first_attr(doc, "meta[name='description']", "content")
        .or_else(|| first_attr(doc, "meta[property='og:description']", "content"))
        .unwrap_or_default();
    budget.take(&description, MAX_DESCRIPTION_BYTES)
}

fn first_text(doc: &Html, selector: &str) -> Option<String> {
    let sel = Selector::parse(selector).ok()?;
    doc.select(&sel)
        .next()
        .map(|el| normalize_ws(&element_text(&el)))
}

fn first_attr(doc: &Html, selector: &str, attr: &str) -> Option<String> {
    let sel = Selector::parse(selector).ok()?;
    doc.select(&sel)
        .next()?
        .value()
        .attr(attr)
        .map(normalize_ws)
        .filter(|s| !s.is_empty())
}
