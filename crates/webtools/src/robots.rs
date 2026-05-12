//! Pure robots.txt parsing and matching.

use serde::{Deserialize, Serialize};

use crate::robots_dispatch::dispatch_robots;
use crate::robots_match::check_robots;
use crate::robots_parse::parse_robots;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RobotsRule {
    pub allow: bool,
    pub pattern: String,
    pub order: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RobotsGroup {
    pub agents: Vec<String>,
    pub rules: Vec<RobotsRule>,
    pub crawl_delay: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RobotsTxt {
    pub groups: Vec<RobotsGroup>,
    pub sitemaps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RobotsCheck {
    pub allowed: bool,
    pub matched_rule: Option<String>,
    pub crawl_delay: Option<f64>,
    pub sitemaps: Vec<String>,
}

impl RobotsTxt {
    pub fn parse(body: &str) -> Self {
        parse_robots(body)
    }

    pub fn sitemaps(&self) -> &[String] {
        &self.sitemaps
    }

    pub fn check(&self, user_agent: &str, url: &str) -> RobotsCheck {
        check_robots(self, user_agent, url)
    }
}

pub fn parse_sitemaps(body: &str) -> Vec<String> {
    RobotsTxt::parse(body).sitemaps
}

pub fn is_allowed(body: &str, user_agent: &str, url: &str) -> RobotsCheck {
    RobotsTxt::parse(body).check(user_agent, url)
}

pub fn dispatch(req: serde_json::Value) -> serde_json::Value {
    dispatch_robots(req)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_robots_fails_open() {
        let c = is_allowed("", "bot", "https://example.com/private");
        assert!(c.allowed);
        assert_eq!(c.matched_rule, None);
    }

    #[test]
    fn disallow_prefix_blocks() {
        let body = "User-agent: *\nDisallow: /private\n";
        let c = is_allowed(body, "bot", "https://example.com/private/x");
        assert!(!c.allowed);
        assert_eq!(c.matched_rule.as_deref(), Some("/private"));
    }

    #[test]
    fn longest_rule_wins_and_allow_ties_win() {
        let body = "User-agent: *\nDisallow: /\nAllow: /public\nDisallow: /public/tmp\n";
        assert!(is_allowed(body, "bot", "https://e.test/public/page").allowed);
        assert!(!is_allowed(body, "bot", "https://e.test/public/tmp/a").allowed);
    }

    #[test]
    fn wildcard_and_end_anchor() {
        let body = "User-agent: *\nDisallow: /*.pdf$\n";
        assert!(!is_allowed(body, "bot", "https://e.test/a/b.pdf").allowed);
        assert!(is_allowed(body, "bot", "https://e.test/a/b.pdf?x=1").allowed);
    }

    #[test]
    fn specific_user_agent_group_beats_star() {
        let body =
            "User-agent: *\nDisallow: /\n\nUser-agent: Snapdragon\nAllow: /\nCrawl-delay: 2.5\n";
        let c = is_allowed(body, "SnapdragonCrawler/0.1", "https://e.test/x");
        assert!(c.allowed);
        assert_eq!(c.crawl_delay, Some(2.5));
    }

    #[test]
    fn sitemaps_are_collected() {
        let body = "Sitemap: https://e.test/sitemap.xml\nUser-agent: *\nDisallow:\n";
        assert_eq!(parse_sitemaps(body), vec!["https://e.test/sitemap.xml"]);
    }

    #[test]
    fn dispatcher_round_trip() {
        let resp = dispatch(json!({
            "op":"check",
            "args":{"body":"User-agent: *\nDisallow: /x\n", "url":"https://e.test/x"}
        }));
        assert_eq!(resp["ok"], json!(true));
        assert_eq!(resp["value"]["allowed"], json!(false));
    }
}
