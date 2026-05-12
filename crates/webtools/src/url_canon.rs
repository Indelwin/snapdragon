use url::Url;

use crate::url_params::strip_tracking_params;
use crate::url_parts::{normalize_path, url_host};

pub fn normalize_input(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    parse_http_url(trimmed).or_else(|| parse_bare_host(trimmed))
}

pub fn canonicalize(raw: &str) -> Option<String> {
    let mut url = Url::parse(raw.trim()).ok()?;
    validate_http_url(&url)?;
    url.set_fragment(None);
    url.set_path(&normalize_path(url.path()));
    strip_tracking_params(&mut url);
    Some(url.to_string())
}

pub fn resolve(base_url: &str, href: &str) -> Option<String> {
    let href = href.trim();
    if rejected_href(href) {
        return None;
    }
    if let Ok(url) = Url::parse(href) {
        return canonicalize(url.as_str());
    }
    let resolved = Url::parse(base_url).ok()?.join(href).ok()?;
    canonicalize(resolved.as_str())
}

pub fn host(url_str: &str) -> String {
    url_host(url_str)
}

pub fn cleanup_url(raw: &str) -> String {
    match Url::parse(raw) {
        Ok(mut url) => {
            strip_tracking_params(&mut url);
            url.to_string()
        }
        Err(_) => raw.to_string(),
    }
}

fn parse_http_url(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    validate_http_url(&url)?;
    canonicalize(url.as_str())
}

fn parse_bare_host(raw: &str) -> Option<String> {
    raw.contains('.')
        .then(|| format!("https://{raw}"))
        .and_then(|url| parse_http_url(&url))
}

fn validate_http_url(url: &Url) -> Option<()> {
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some()).then_some(())
}

fn rejected_href(href: &str) -> bool {
    href.is_empty()
        || href.starts_with('#')
        || href.starts_with("javascript:")
        || href.starts_with("mailto:")
        || href.starts_with("tel:")
}
