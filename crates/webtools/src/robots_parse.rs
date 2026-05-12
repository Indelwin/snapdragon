use crate::robots::{RobotsGroup, RobotsRule, RobotsTxt};

#[derive(Default)]
struct Builder {
    groups: Vec<RobotsGroup>,
    agents: Vec<String>,
    rules: Vec<RobotsRule>,
    crawl_delay: Option<f64>,
    sitemaps: Vec<String>,
    order: usize,
    seen_rule: bool,
}

pub(crate) fn parse_robots(body: &str) -> RobotsTxt {
    let mut builder = Builder::default();
    for raw_line in body.lines() {
        builder.accept_line(raw_line);
    }
    builder.finish()
}

impl Builder {
    fn accept_line(&mut self, raw_line: &str) {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            self.flush();
            self.seen_rule = false;
            return;
        }
        let Some((field, value)) = line.split_once(':') else {
            return;
        };
        self.accept_directive(field.trim(), value.trim());
    }

    fn accept_directive(&mut self, field: &str, value: &str) {
        match field.to_ascii_lowercase().as_str() {
            "user-agent" => self.accept_agent(value),
            "allow" | "disallow" => self.accept_rule(field, value),
            "crawl-delay" => self.accept_delay(value),
            "sitemap" => self.accept_sitemap(value),
            _ => {}
        }
    }

    fn accept_agent(&mut self, value: &str) {
        if self.seen_rule {
            self.flush();
            self.seen_rule = false;
        }
        if !value.is_empty() {
            self.agents.push(value.to_ascii_lowercase());
        }
    }

    fn accept_rule(&mut self, field: &str, value: &str) {
        self.seen_rule = true;
        if value.is_empty() {
            return;
        }
        self.rules.push(RobotsRule {
            allow: field.eq_ignore_ascii_case("allow"),
            pattern: value.to_string(),
            order: self.order,
        });
        self.order += 1;
    }

    fn accept_delay(&mut self, value: &str) {
        self.seen_rule = true;
        if let Ok(delay) = value.parse::<f64>() {
            self.crawl_delay = Some(delay.max(0.0));
        }
    }

    fn accept_sitemap(&mut self, value: &str) {
        if !value.is_empty() {
            self.sitemaps.push(value.to_string());
        }
    }

    fn flush(&mut self) {
        if self.agents.is_empty() {
            self.rules.clear();
            self.crawl_delay = None;
            return;
        }
        self.groups.push(RobotsGroup {
            agents: std::mem::take(&mut self.agents),
            rules: std::mem::take(&mut self.rules),
            crawl_delay: self.crawl_delay.take(),
        });
    }

    fn finish(mut self) -> RobotsTxt {
        self.flush();
        RobotsTxt {
            groups: self.groups,
            sitemaps: self.sitemaps,
        }
    }
}
