pub(crate) fn robots_match(path: &str, pattern: &str) -> bool {
    if pattern.is_empty() {
        return false;
    }
    let anchored_end = pattern.ends_with('$');
    let pat = pattern.trim_end_matches('$');
    if !pat.contains('*') {
        return plain_match(path, pat, anchored_end);
    }
    wildcard_match(path, pat, anchored_end)
}

fn plain_match(path: &str, pattern: &str, anchored_end: bool) -> bool {
    path.starts_with(pattern) && (!anchored_end || path.len() == pattern.len())
}

fn wildcard_match(path: &str, pattern: &str, anchored_end: bool) -> bool {
    let mut pos = 0usize;
    let mut first = true;
    for part in pattern.split('*').filter(|part| !part.is_empty()) {
        let Some(next_pos) = next_part_pos(path, pattern, part, pos, first) else {
            return false;
        };
        pos = next_pos;
        first = false;
    }
    !anchored_end
        || pattern_last_part(pattern)
            .map(|last| path.ends_with(last))
            .unwrap_or(true)
}

fn next_part_pos(path: &str, pattern: &str, part: &str, pos: usize, first: bool) -> Option<usize> {
    if first && !pattern.starts_with('*') {
        return path[pos..].starts_with(part).then_some(pos + part.len());
    }
    path[pos..].find(part).map(|found| pos + found + part.len())
}

fn pattern_last_part(pattern: &str) -> Option<&str> {
    pattern.rsplit('*').find(|part| !part.is_empty())
}
