use scraper::{Html, Selector};

use crate::extractor::{HeadingInfo, ImageInfo, LinkInfo};
use crate::extractor_text::{element_text, normalize_ws};

pub(crate) fn extract_title(doc: &Html) -> String {
    if let Some(title) = first_text(doc, "title") {
        if !title.is_empty() {
            return title;
        }
    }
    first_attr(doc, "meta[property='og:title']", "content").unwrap_or_default()
}

pub(crate) fn extract_meta_description(doc: &Html) -> String {
    first_attr(doc, "meta[name='description']", "content")
        .or_else(|| first_attr(doc, "meta[property='og:description']", "content"))
        .unwrap_or_default()
}

pub(crate) fn extract_links(doc: &Html) -> Vec<LinkInfo> {
    let Some(sel) = Selector::parse("a[href]").ok() else {
        return vec![];
    };
    doc.select(&sel)
        .filter_map(|el| {
            let href = el.value().attr("href")?.to_string();
            useful_href(&href).then(|| LinkInfo {
                href,
                text: normalize_ws(&element_text(&el)),
            })
        })
        .collect()
}

pub(crate) fn extract_images(doc: &Html) -> Vec<ImageInfo> {
    let Some(sel) = Selector::parse("img[src]").ok() else {
        return vec![];
    };
    doc.select(&sel)
        .filter_map(|el| {
            let src = el.value().attr("src")?.to_string();
            useful_image_src(&src).then(|| ImageInfo {
                src,
                alt: el.value().attr("alt").unwrap_or("").to_string(),
            })
        })
        .collect()
}

pub(crate) fn extract_headings(doc: &Html) -> Vec<HeadingInfo> {
    let Some(sel) = Selector::parse("h1, h2, h3, h4, h5, h6").ok() else {
        return vec![];
    };
    doc.select(&sel)
        .filter_map(|el| {
            let level: u8 = el.value().name()[1..].parse().ok()?;
            let text = normalize_ws(&element_text(&el));
            (!text.is_empty()).then_some(HeadingInfo { level, text })
        })
        .collect()
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

fn useful_href(href: &str) -> bool {
    let lower = href.to_ascii_lowercase();
    !href.starts_with('#') && !lower.starts_with("javascript:") && !lower.starts_with("mailto:")
}

fn useful_image_src(src: &str) -> bool {
    !(src.starts_with("data:image") && src.len() < 200)
}
