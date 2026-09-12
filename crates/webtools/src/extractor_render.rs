use scraper::{ElementRef, Node, Selector};

use crate::extractor_boilerplate::is_boilerplate_element;
use crate::extractor_text::{element_text, normalize_ws, truncate_str};

pub(crate) fn container_to_markdown(container: &ElementRef, max_chars: usize) -> (String, bool) {
    let mut output = String::new();
    let mut output_chars = 0;
    for child in container.children() {
        let markdown = match child.value() {
            Node::Element(_) => {
                if let Some(el_ref) = ElementRef::wrap(child) {
                    element_markdown(&el_ref)
                } else {
                    None
                }
            }
            Node::Text(text) => text_markdown(&text.text),
            _ => None,
        };
        if let Some(markdown) = markdown {
            let truncated = append_markdown(&mut output, &mut output_chars, &markdown, max_chars);
            if truncated {
                return (output, true);
            }
        }
    }
    (output, false)
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

fn element_markdown(el_ref: &ElementRef) -> Option<String> {
    if is_boilerplate_element(&el_ref) {
        return None;
    }
    let tag = el_ref.value().name();
    let text = normalize_ws(&element_text(&el_ref));
    if text.is_empty() {
        return None;
    }
    let markdown = nested_markdown(tag, &text, &el_ref);
    (!markdown.is_empty()).then_some(markdown)
}

fn nested_markdown(tag: &str, text: &str, el: &ElementRef) -> String {
    match tag {
        "ul" | "ol" => extract_list(el),
        "table" => extract_table_text(el),
        _ => tag_markdown(tag, text),
    }
}

fn text_markdown(text: &str) -> Option<String> {
    let text = normalize_ws(text);
    (!text.is_empty()).then_some(text)
}

pub(crate) fn append_markdown(
    output: &mut String,
    output_chars: &mut usize,
    markdown: &str,
    max_chars: usize,
) -> bool {
    let separator = if output.is_empty() { "" } else { "\n\n" };
    let added_chars = separator.chars().count() + markdown.chars().count();
    if *output_chars + added_chars <= max_chars {
        output.push_str(separator);
        output.push_str(markdown);
        *output_chars += added_chars;
        return false;
    }
    let candidate = format!("{output}{separator}{markdown}");
    let (bounded, _) = truncate_str(&candidate, max_chars);
    *output = bounded;
    *output_chars = max_chars;
    true
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
