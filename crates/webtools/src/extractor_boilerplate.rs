use scraper::ElementRef;

const BOILERPLATE_TAGS: &[&str] = &["nav", "footer", "aside", "header"];
const BOILERPLATE_CLASS_TOKENS: &[&str] = &[
    "ad",
    "ads",
    "advert",
    "banner",
    "cookie",
    "popup",
    "modal",
    "sidebar",
    "navigation",
    "newsletter",
    "social-share",
];

pub(crate) fn is_boilerplate_element(el: &ElementRef) -> bool {
    BOILERPLATE_TAGS.contains(&el.value().name())
        || has_boilerplate_attr(el)
        || el
            .value()
            .attr("aria-hidden")
            .map(|v| v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
}

pub(crate) fn is_boilerplate_ancestor(el: &ElementRef) -> bool {
    let mut current = el.parent();
    while let Some(node) = current {
        if ElementRef::wrap(node)
            .map(|el_ref| is_boilerplate_element(&el_ref))
            .unwrap_or(false)
        {
            return true;
        }
        current = node.parent();
    }
    false
}

fn has_boilerplate_attr(el: &ElementRef) -> bool {
    ["class", "id"].iter().any(|attr| {
        el.value()
            .attr(attr)
            .map(|value| {
                let lower = value.to_lowercase();
                BOILERPLATE_CLASS_TOKENS
                    .iter()
                    .any(|token| lower.contains(token))
            })
            .unwrap_or(false)
    })
}
