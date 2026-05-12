use std::borrow::Cow;

const STRIP_TAGS: &[&str] = &["script", "style", "noscript", "template", "svg", "iframe"];

lazy_static::lazy_static! {
    static ref STRIP_TAG_RE: regex::Regex = {
        let pattern = STRIP_TAGS
            .iter()
            .map(|tag| format!(r"<{tag}\b[^>]*>[\s\S]*?</{tag}\s*>"))
            .collect::<Vec<_>>()
            .join("|");
        regex::RegexBuilder::new(&pattern)
            .case_insensitive(true)
            .build()
            .expect("STRIP_TAG_RE build")
    };
}

pub(crate) fn strip_never_render(html: &str) -> Cow<'_, str> {
    STRIP_TAG_RE.replace_all(html, "")
}
