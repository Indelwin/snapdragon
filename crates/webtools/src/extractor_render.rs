use scraper::{ElementRef, Node, Selector};

use crate::extractor_boilerplate::is_boilerplate_element;
use crate::extractor_text::{element_text, normalize_ws, truncate_str};

pub(crate) fn container_to_markdown(container: &ElementRef, max_chars: usize) -> String {
    let mut parts = Vec::new();
    for child in container.children() {
        match child.value() {
            Node::Element(_) => {
                if let Some(el_ref) = ElementRef::wrap(child) {
                    push_element_markdown(&el_ref, &mut parts);
                }
            }
            Node::Text(text) => push_text_markdown(&text.text, &mut parts),
            _ => {}
        }
    }
    truncate_str(&parts.join("\n\n"), max_chars)
}

pub(crate) fn tag_markdown(tag: &str, text: &str) -> String {
    match tag {
        "h1" => format!("# {}", text),
        "h2" => format!("## {}", text),
        "h3" => format!("### {}", text),
        "h4" => format!("#### {}", text),
        "h5" => format!("##### {}", text),
        "h6" => format!("###### {}", text),
        "pre" | "code" => format!("```\n{}\n```", text),
        "blockquote" => format!("> {}", text),
        "li" => format!("- {}", text),
        _ => text.to_string(),
    }
}

fn push_element_markdown(el_ref: &ElementRef, parts: &mut Vec<String>) {
    if is_boilerplate_element(&el_ref) {
        return;
    }
    let tag = el_ref.value().name();
    let text = normalize_ws(&element_text(&el_ref));
    if text.is_empty() {
        return;
    }
    let markdown = nested_markdown(tag, &text, &el_ref);
    if !markdown.is_empty() {
        parts.push(markdown);
    }
}

fn nested_markdown(tag: &str, text: &str, el: &ElementRef) -> String {
    match tag {
        "ul" | "ol" => extract_list(el),
        "table" => extract_table_text(el),
        _ => tag_markdown(tag, text),
    }
}

fn push_text_markdown(text: &str, parts: &mut Vec<String>) {
    let text = normalize_ws(text);
    if !text.is_empty() {
        parts.push(text);
    }
}

fn extract_list(el: &ElementRef) -> String {
    let li_sel = Selector::parse("li").unwrap();
    el.select(&li_sel)
        .map(|li| format!("- {}", normalize_ws(&element_text(&li))))
        .filter(|s| s.len() > 2)
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_table_text(el: &ElementRef) -> String {
    let row_sel = Selector::parse("tr").unwrap();
    let cell_sel = Selector::parse("td, th").unwrap();
    el.select(&row_sel)
        .map(|row| table_row_text(&row, &cell_sel))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn table_row_text(row: &ElementRef, cell_sel: &Selector) -> String {
    row.select(cell_sel)
        .map(|cell| normalize_ws(&element_text(&cell)))
        .collect::<Vec<_>>()
        .join(" | ")
}
