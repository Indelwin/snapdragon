use url::Url;

pub(crate) fn normalize_host(host: impl AsRef<str>) -> String {
    host.as_ref()
        .to_lowercase()
        .trim()
        .trim_end_matches('.')
        .to_string()
}

pub(crate) fn normalize_path(path: &str) -> String {
    let collapsed = collapse_slashes(path);
    if collapsed.len() > 1 && collapsed.ends_with('/') {
        collapsed.trim_end_matches('/').to_string()
    } else if collapsed.is_empty() {
        "/".to_string()
    } else {
        collapsed
    }
}

pub fn same_or_subdomain(host_str: &str, root_host: &str) -> bool {
    let host = normalize_host(host_str);
    let root = normalize_host(root_host);
    !host.is_empty() && !root.is_empty() && (host == root || host.ends_with(&format!(".{root}")))
}

pub(crate) fn url_host(url_str: &str) -> String {
    Url::parse(url_str)
        .ok()
        .and_then(|url| url.host_str().map(normalize_host))
        .unwrap_or_default()
}

fn collapse_slashes(path: &str) -> String {
    let mut collapsed = String::with_capacity(path.len().max(1));
    let mut prev_slash = false;
    for ch in path.chars() {
        push_collapsed_char(ch, &mut prev_slash, &mut collapsed);
    }
    collapsed
}

fn push_collapsed_char(ch: char, prev_slash: &mut bool, out: &mut String) {
    if ch == '/' {
        if !*prev_slash {
            out.push(ch);
        }
        *prev_slash = true;
    } else {
        out.push(ch);
        *prev_slash = false;
    }
}
