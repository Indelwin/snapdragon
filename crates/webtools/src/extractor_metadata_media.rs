use scraper::{Html, Selector};

use crate::extractor::{HeadingInfo, ImageInfo};
use crate::extractor_metadata_budget::MetadataBudget;
use crate::extractor_text::{element_text, normalize_ws};

const MAX_URL_BYTES: usize = 8_192;
const MAX_TEXT_BYTES: usize = 4_096;
const MAX_IMAGES: usize = 512;
const MAX_HEADINGS: usize = 512;

pub(crate) fn extract_images(doc: &Html, budget: &mut MetadataBudget) -> Vec<ImageInfo> {
    let Some(selector) = Selector::parse("img[src]").ok() else {
        return vec![];
    };
    let mut images = Vec::new();
    for element in doc.select(&selector) {
        let Some(src) = element.value().attr("src") else {
            continue;
        };
        if !useful_image_src(src) {
            continue;
        }
        if !budget.item_allowed(images.len(), MAX_IMAGES) {
            break;
        }
        images.push(ImageInfo {
            src: budget.take(src, MAX_URL_BYTES),
            alt: budget.take(element.value().attr("alt").unwrap_or(""), MAX_TEXT_BYTES),
        });
    }
    images
}

pub(crate) fn extract_headings(doc: &Html, budget: &mut MetadataBudget) -> Vec<HeadingInfo> {
    let Some(selector) = Selector::parse("h1, h2, h3, h4, h5, h6").ok() else {
        return vec![];
    };
    let mut headings = Vec::new();
    for element in doc.select(&selector) {
        let Ok(level) = element.value().name()[1..].parse::<u8>() else {
            continue;
        };
        let text = normalize_ws(&element_text(&element));
        if text.is_empty() {
            continue;
        }
        if !budget.item_allowed(headings.len(), MAX_HEADINGS) {
            break;
        }
        headings.push(HeadingInfo {
            level,
            text: budget.take(&text, MAX_TEXT_BYTES),
        });
    }
    headings
}

fn useful_image_src(src: &str) -> bool {
    !(src.starts_with("data:image") && src.len() < 200)
}
