const MAX_METADATA_BYTES: usize = 1_000_000;

pub(crate) struct MetadataBudget {
    remaining: usize,
    truncated: bool,
}

impl MetadataBudget {
    pub(crate) fn new() -> Self {
        Self {
            remaining: MAX_METADATA_BYTES,
            truncated: false,
        }
    }

    pub(crate) fn truncated(&self) -> bool {
        self.truncated
    }

    pub(crate) fn take(&mut self, value: &str, field_limit: usize) -> String {
        let limit = self.remaining.min(field_limit);
        let bounded = truncate_utf8_bytes(value, limit);
        if bounded.len() < value.len() {
            self.truncated = true;
        }
        self.remaining = self.remaining.saturating_sub(bounded.len());
        bounded.to_string()
    }

    pub(crate) fn item_allowed(&mut self, count: usize, limit: usize) -> bool {
        if count < limit && self.remaining > 0 {
            return true;
        }
        self.truncated = true;
        false
    }
}

fn truncate_utf8_bytes(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &value[..boundary]
}
