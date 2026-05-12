use url::Url;

use crate::robots::{RobotsCheck, RobotsGroup, RobotsRule, RobotsTxt};
use crate::robots_pattern::robots_match;

pub(crate) fn check_robots(txt: &RobotsTxt, user_agent: &str, url: &str) -> RobotsCheck {
    let path = path_and_query(url).unwrap_or_else(|| url.to_string());
    let groups = matching_groups(txt, user_agent);
    let crawl_delay = groups.iter().find_map(|group| group.crawl_delay);
    let best = best_rule(&groups, &path);
    RobotsCheck {
        allowed: best.map(|rule| rule.allow).unwrap_or(true),
        matched_rule: best.map(|rule| rule.pattern.clone()),
        crawl_delay,
        sitemaps: txt.sitemaps.clone(),
    }
}

fn matching_groups<'a>(txt: &'a RobotsTxt, user_agent: &str) -> Vec<&'a RobotsGroup> {
    let ua = user_agent.to_ascii_lowercase();
    let mut best_len = 0usize;
    let mut matches = Vec::<&RobotsGroup>::new();
    for group in &txt.groups {
        accept_group_match(group, &ua, &mut best_len, &mut matches);
    }
    matches
}

fn accept_group_match<'a>(
    group: &'a RobotsGroup,
    ua: &str,
    best_len: &mut usize,
    matches: &mut Vec<&'a RobotsGroup>,
) {
    for agent in &group.agents {
        let len = agent_match_len(agent, ua);
        if len == 0 {
            continue;
        }
        if len > *best_len {
            *best_len = len;
            matches.clear();
        }
        if len == *best_len {
            matches.push(group);
        }
    }
}

fn agent_match_len(agent: &str, ua: &str) -> usize {
    if agent == "*" {
        1
    } else if ua.contains(agent) {
        agent.len()
    } else {
        0
    }
}

fn best_rule<'a>(groups: &[&'a RobotsGroup], path: &str) -> Option<&'a RobotsRule> {
    groups
        .iter()
        .flat_map(|group| group.rules.iter())
        .filter(|rule| robots_match(path, &rule.pattern))
        .max_by(|left, right| compare_rules(left, right))
}

fn compare_rules(left: &RobotsRule, right: &RobotsRule) -> std::cmp::Ordering {
    rule_rank(left).cmp(&rule_rank(right))
}

fn rule_rank(rule: &RobotsRule) -> (usize, bool, usize) {
    (rule_specificity(&rule.pattern), rule.allow, rule.order)
}

fn path_and_query(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let mut path = parsed.path().to_string();
    if path.is_empty() {
        path.push('/');
    }
    if let Some(query) = parsed.query() {
        path.push('?');
        path.push_str(query);
    }
    Some(path)
}

fn rule_specificity(pattern: &str) -> usize {
    pattern
        .trim_end_matches('$')
        .chars()
        .filter(|&c| c != '*')
        .count()
}
