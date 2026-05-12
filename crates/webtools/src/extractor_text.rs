use scraper::ElementRef;

pub(crate) fn element_text(el: &ElementRef) -> String {
    el.text().collect::<Vec<_>>().join(" ")
}

pub(crate) fn normalize_ws(text: &str) -> String {
    regex::Regex::new(r"\s+")
        .expect("ws regex")
        .replace_all(text, " ")
        .trim()
        .to_string()
}

pub(crate) fn truncate_str(text: &str, max: usize) -> String {
    if text.len() <= max {
        text.to_string()
    } else {
        format!(
            "{}\n...(truncated)",
            text.chars().take(max).collect::<String>()
        )
    }
}
