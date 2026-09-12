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

pub(crate) fn truncate_str(text: &str, max_chars: usize) -> (String, bool) {
    if text.chars().count() <= max_chars {
        return (text.to_string(), false);
    }

    const MARKER: &str = "\n...(truncated)";
    let marker_chars = MARKER.chars().count();
    if max_chars <= marker_chars {
        return (MARKER.chars().take(max_chars).collect(), true);
    }
    let mut output: String = text.chars().take(max_chars - marker_chars).collect();
    output.push_str(MARKER);
    (output, true)
}
