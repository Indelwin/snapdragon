use scraper::{Html, Selector};

use crate::extractor::LinkInfo;
use crate::extractor_metadata_budget::MetadataBudget;
use crate::extractor_text::{element_text, normalize_ws};

const MAX_URL_BYTES: usize = 8_192;
const MAX_TEXT_BYTES: usize = 4_096;
const MAX_LINKS: usize = 1_024;

pub(crate) fn extract_links(doc: &Html, budget: &mut MetadataBudget) -> Vec<LinkInfo> {
    let Some(selector) = Selector::parse("a[href]").ok() else {
        return vec![];
    };
    let mut links = Vec::new();
    for element in doc.select(&selector) {
        let Some(href) = element.value().attr("href") else {
            continue;
        };
        if !useful_href(href) {
            continue;
        }
        if !budget.item_allowed(links.len(), MAX_LINKS) {
            break;
        }
        links.push(LinkInfo {
            href: budget.take(href, MAX_URL_BYTES),
            text: budget.take(&normalize_ws(&element_text(&element)), MAX_TEXT_BYTES),
        });
    }
    links
}

fn useful_href(href: &str) -> bool {
    let lower = href.to_ascii_lowercase();
    !href.starts_with('#') && !lower.starts_with("javascript:") && !lower.starts_with("mailto:")
}
