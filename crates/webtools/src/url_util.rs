//! URL normalisation, canonicalisation, and pattern matching.

pub use crate::url_canon::{canonicalize, cleanup_url, host, normalize_input, resolve};
pub use crate::url_match::pattern_match;
pub use crate::url_parts::same_or_subdomain;

pub fn dispatch(req: serde_json::Value) -> serde_json::Value {
    crate::url_dispatch::dispatch_url_util(req)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalize_input_adds_scheme() {
        assert_eq!(
            normalize_input("example.com"),
            Some("https://example.com/".to_string())
        );
    }

    #[test]
    fn normalize_input_strips_trailing_slash() {
        assert_eq!(
            normalize_input("https://example.com/path/"),
            Some("https://example.com/path".to_string())
        );
    }

    #[test]
    fn normalize_input_rejects_empty_and_invalid() {
        assert!(normalize_input("").is_none());
        assert!(normalize_input("not a url at all").is_none());
        assert!(normalize_input("ftp:").is_none());
    }

    #[test]
    fn canonicalize_strips_tracking_and_sorts() {
        let url = "https://example.com/page?z=last&utm_source=google&fbclid=abc&a=first";
        let result = canonicalize(url).unwrap();
        assert!(result.contains("a=first"));
        assert!(result.contains("z=last"));
        assert!(!result.contains("utm_source"));
        assert!(!result.contains("fbclid"));
        assert!(result.find("a=first").unwrap() < result.find("z=last").unwrap());
    }

    #[test]
    fn canonicalize_drops_fragment() {
        assert_eq!(
            canonicalize("https://example.com/page#section"),
            Some("https://example.com/page".to_string())
        );
    }

    #[test]
    fn canonicalize_collapses_slashes() {
        assert_eq!(
            canonicalize("https://example.com///a//b///"),
            Some("https://example.com/a/b".to_string())
        );
    }

    #[test]
    fn resolve_relative_paths() {
        let base = "https://example.com/docs/intro";
        assert_eq!(
            resolve(base, "/about"),
            Some("https://example.com/about".to_string())
        );
        assert_eq!(
            resolve(base, "next"),
            Some("https://example.com/docs/next".to_string())
        );
    }

    #[test]
    fn resolve_rejects_pseudo_schemes() {
        let base = "https://example.com/x";
        assert!(resolve(base, "#anchor").is_none());
        assert!(resolve(base, "javascript:void(0)").is_none());
        assert!(resolve(base, "mailto:foo@bar").is_none());
        assert!(resolve(base, "tel:+15551234").is_none());
        assert!(resolve(base, "ftp://other").is_none());
    }

    #[test]
    fn same_or_subdomain_matrix() {
        assert!(same_or_subdomain("docs.example.com", "example.com"));
        assert!(same_or_subdomain("example.com", "example.com"));
        assert!(same_or_subdomain("a.b.example.com", "example.com"));
        assert!(!same_or_subdomain("other.com", "example.com"));
        assert!(!same_or_subdomain("notexample.com", "example.com"));
        assert!(!same_or_subdomain("", "example.com"));
    }

    #[test]
    fn pattern_match_basics() {
        assert!(pattern_match("https://example.com/docs/page", "*docs*"));
        assert!(pattern_match("anything", "*"));
        assert!(pattern_match("anything", ""));
        assert!(!pattern_match("https://example.com/blog", "*docs*"));
        assert!(pattern_match("abc", "a?c"));
        assert!(!pattern_match("ac", "a?c"));
        assert!(pattern_match("https://example.com/", "https://*/"));
        assert!(pattern_match("foo", "foo*"));
        assert!(pattern_match("foo", "*foo"));
    }

    #[test]
    fn cleanup_preserves_non_tracking() {
        let cleaned = cleanup_url("https://example.com/p?q=hello&utm_source=x");
        assert!(cleaned.contains("q=hello"));
        assert!(!cleaned.contains("utm_source"));
    }

    #[test]
    fn dispatch_normalize_round_trip() {
        let resp = dispatch(json!({ "op": "normalize", "args": { "raw": "example.com" } }));
        assert_eq!(resp["ok"], json!(true));
        assert_eq!(resp["value"], json!("https://example.com/"));
    }

    #[test]
    fn dispatch_unknown_op_is_error() {
        let resp = dispatch(json!({ "op": "nope" }));
        assert_eq!(resp["ok"], json!(false));
    }

    #[test]
    fn dispatch_missing_args_is_error() {
        let resp = dispatch(json!({ "op": "resolve", "args": { "base": "https://a/" } }));
        assert_eq!(resp["ok"], json!(false));
    }
}
