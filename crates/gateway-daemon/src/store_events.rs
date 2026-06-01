use rusqlite::{OptionalExtension, params};
use serde_json::Value;
use snapdragon_gateway_core::{GatewayEventRecord, GatewayEventState, GatewayLogRecord};

use crate::store::{GatewayStore, json_string, optional_json};

impl GatewayStore {
    pub fn append_event(&self, event: GatewayEventRecord) -> Result<GatewayEventRecord, String> {
        self.with_conn(|conn| {
            conn.execute(
                "insert into gateway_events(id, kind, target, state, payload_json, created_at_ms, updated_at_ms)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 on conflict(id) do update set
                   kind=excluded.kind,
                   target=excluded.target,
                   state=excluded.state,
                   payload_json=excluded.payload_json,
                   updated_at_ms=excluded.updated_at_ms",
                params![
                    event.id,
                    event.kind,
                    event.target,
                    event_state(&event.state),
                    json_string(&event.payload)?,
                    event.created_at_ms,
                    event.updated_at_ms
                ],
            )
            .map(|_| event)
            .map_err(|error| error.to_string())
        })
    }

    pub fn list_events(&self) -> Result<Vec<GatewayEventRecord>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select id, kind, target, state, payload_json, created_at_ms, updated_at_ms
                     from gateway_events order by updated_at_ms desc, id",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], event_from_row)
                .map_err(|error| error.to_string())?;
            rows.map(|row| row.map_err(|error| error.to_string()))
                .collect()
        })
    }

    pub fn cancel_event(
        &self,
        id: &str,
        now_ms: u64,
    ) -> Result<Option<GatewayEventRecord>, String> {
        let Some(mut event) = self.event(id)? else {
            return Ok(None);
        };
        event.state = GatewayEventState::Cancelled;
        event.updated_at_ms = now_ms;
        self.append_event(event.clone())?;
        self.append_log(now_ms, "warn", Some(id), "event cancelled", None)?;
        Ok(Some(event))
    }

    pub fn tail_logs(
        &self,
        target: Option<&str>,
        limit: u64,
    ) -> Result<Vec<GatewayLogRecord>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(log_query(target))
                .map_err(|error| error.to_string())?;
            let mut logs = query_logs(&mut stmt, target, limit)?;
            logs.reverse();
            Ok(logs)
        })
    }

    pub fn append_log(
        &self,
        at_ms: u64,
        level: &str,
        target: Option<&str>,
        message: &str,
        data: Option<Value>,
    ) -> Result<GatewayLogRecord, String> {
        self.with_conn(|conn| {
            conn.execute(
                "insert into gateway_logs(at_ms, level, target, message, data_json)
                 values (?1, ?2, ?3, ?4, ?5)",
                params![at_ms, level, target, message, optional_json(data.as_ref())?],
            )
            .map_err(|error| error.to_string())?;
            Ok(GatewayLogRecord {
                id: conn.last_insert_rowid() as u64,
                at_ms,
                level: level.to_string(),
                target: target.map(str::to_string),
                message: message.to_string(),
                data,
            })
        })
    }

    fn event(&self, id: &str) -> Result<Option<GatewayEventRecord>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "select id, kind, target, state, payload_json, created_at_ms, updated_at_ms
                 from gateway_events where id=?1",
                params![id],
                event_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())
        })
    }
}

fn log_query(target: Option<&str>) -> &'static str {
    match target {
        Some(_) => {
            "select id, at_ms, level, target, message, data_json from gateway_logs
             where target=?1 order by id desc limit ?2"
        }
        None => {
            "select id, at_ms, level, target, message, data_json from gateway_logs
             order by id desc limit ?1"
        }
    }
}

fn query_logs(
    stmt: &mut rusqlite::Statement<'_>,
    target: Option<&str>,
    limit: u64,
) -> Result<Vec<GatewayLogRecord>, String> {
    let rows = match target {
        Some(target) => stmt
            .query_map(params![target, limit], log_from_row)
            .map_err(|error| error.to_string()),
        None => stmt
            .query_map(params![limit], log_from_row)
            .map_err(|error| error.to_string()),
    }?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

fn event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GatewayEventRecord> {
    let payload_json: String = row.get(4)?;
    Ok(GatewayEventRecord {
        id: row.get(0)?,
        kind: row.get(1)?,
        target: row.get(2)?,
        state: parse_event_state(row.get::<_, String>(3)?.as_str()),
        payload: serde_json::from_str(&payload_json).unwrap_or(Value::Null),
        created_at_ms: row.get(5)?,
        updated_at_ms: row.get(6)?,
    })
}

pub(crate) fn log_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GatewayLogRecord> {
    let data_json: Option<String> = row.get(5)?;
    Ok(GatewayLogRecord {
        id: row.get(0)?,
        at_ms: row.get(1)?,
        level: row.get(2)?,
        target: row.get(3)?,
        message: row.get(4)?,
        data: data_json.and_then(|json| serde_json::from_str(&json).ok()),
    })
}

fn event_state(state: &GatewayEventState) -> &'static str {
    match state {
        GatewayEventState::Pending => "pending",
        GatewayEventState::Running => "running",
        GatewayEventState::Done => "done",
        GatewayEventState::Failed => "failed",
        GatewayEventState::Cancelled => "cancelled",
    }
}

fn parse_event_state(value: &str) -> GatewayEventState {
    match value {
        "running" => GatewayEventState::Running,
        "done" => GatewayEventState::Done,
        "failed" => GatewayEventState::Failed,
        "cancelled" => GatewayEventState::Cancelled,
        _ => GatewayEventState::Pending,
    }
}
