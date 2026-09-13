use serde::Serialize;
use serde_json::Value;

use crate::{
    ipc::{ok_json, parse},
    ipc_params::ListPageParams,
};

#[derive(Serialize)]
struct ListPage<T> {
    items: Vec<T>,
    next_cursor: Option<String>,
}

pub(crate) fn paged<T: Serialize>(params: Value, values: Vec<T>) -> Result<Value, String> {
    let params = if params.is_null() {
        ListPageParams::default()
    } else {
        parse::<ListPageParams>(params)?
    };
    let offset = params
        .cursor
        .as_deref()
        .unwrap_or("0")
        .parse::<usize>()
        .map_err(|_| "invalid list cursor".to_string())?;
    let limit = params.limit.unwrap_or(100).clamp(1, 100);
    let mut items = values
        .into_iter()
        .skip(offset)
        .take(limit + 1)
        .collect::<Vec<_>>();
    let has_more = items.len() > limit;
    items.truncate(limit);
    ok_json(ListPage {
        next_cursor: has_more.then(|| offset.saturating_add(items.len()).to_string()),
        items,
    })
}
