use std::collections::HashSet;
use std::sync::OnceLock;
use url::Url;

fn tracking_params() -> &'static HashSet<&'static str> {
    static PARAMS: OnceLock<HashSet<&'static str>> = OnceLock::new();
    PARAMS.get_or_init(|| {
        [
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content",
            "gclid",
            "fbclid",
            "mc_cid",
            "mc_eid",
            "ref",
            "source",
        ]
        .into_iter()
        .collect()
    })
}

pub(crate) fn strip_tracking_params(url: &mut Url) {
    let mut pairs = query_pairs(url);
    pairs.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    if pairs.is_empty() {
        url.set_query(None);
    } else {
        url.set_query(Some(&pairs_to_query(&pairs)));
    }
}

fn query_pairs(url: &Url) -> Vec<(String, String)> {
    let drop_set = tracking_params();
    url.query_pairs()
        .filter(|(key, value)| keep_pair(key, value, drop_set))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

fn keep_pair(
    key: &std::borrow::Cow<'_, str>,
    value: &std::borrow::Cow<'_, str>,
    drop_set: &HashSet<&'static str>,
) -> bool {
    !drop_set.contains(key.to_lowercase().as_str()) && !value.trim().is_empty()
}

fn pairs_to_query(pairs: &[(String, String)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}
