pub fn pattern_match(url: &str, pattern: &str) -> bool {
    if pattern.is_empty() || pattern == "*" {
        return true;
    }
    wildcard_match(pattern.as_bytes(), url.as_bytes())
}

fn wildcard_match(pattern: &[u8], text: &[u8]) -> bool {
    let mut cursor = Cursor::default();
    while cursor.t < text.len() {
        if literal_or_question(pattern, text, cursor.p, cursor.t) {
            cursor.advance_both();
        } else if star_at(pattern, cursor.p) {
            cursor.remember_star();
        } else if !cursor.backtrack() {
            return false;
        }
    }
    cursor.consume_trailing_stars(pattern);
    cursor.p == pattern.len()
}

#[derive(Default)]
struct Cursor {
    p: usize,
    t: usize,
    star_p: Option<usize>,
    star_t: usize,
}

impl Cursor {
    fn advance_both(&mut self) {
        self.p += 1;
        self.t += 1;
    }

    fn remember_star(&mut self) {
        self.star_p = Some(self.p);
        self.star_t = self.t;
        self.p += 1;
    }

    fn backtrack(&mut self) -> bool {
        let Some(star) = self.star_p else {
            return false;
        };
        self.p = star + 1;
        self.star_t += 1;
        self.t = self.star_t;
        true
    }

    fn consume_trailing_stars(&mut self, pattern: &[u8]) {
        while star_at(pattern, self.p) {
            self.p += 1;
        }
    }
}

fn literal_or_question(pattern: &[u8], text: &[u8], p: usize, t: usize) -> bool {
    p < pattern.len() && (pattern[p] == b'?' || pattern[p] == text[t])
}

fn star_at(pattern: &[u8], p: usize) -> bool {
    p < pattern.len() && pattern[p] == b'*'
}
