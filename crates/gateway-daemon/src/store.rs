use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

#[derive(Clone)]
pub struct GatewayStore {
    conn: Arc<Mutex<Connection>>,
}

impl GatewayStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let conn = Connection::open(path).map_err(|error| error.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| error.to_string())?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| error.to_string())?;
        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        store.init()?;
        Ok(store)
    }

    pub fn init(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute_batch(SCHEMA)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    }

    pub(crate) fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "gateway store lock poisoned")?;
        f(&conn)
    }
}

pub(crate) const SCHEMA: &str = r#"
create table if not exists gateway_jobs(
  id text primary key,
  kind text not null,
  queue text not null,
  state text not null,
  priority integer not null default 0,
  status_json text not null,
  updated_at_ms integer not null
);
create index if not exists gateway_jobs_queue_state on gateway_jobs(queue, state, priority, id);

create table if not exists gateway_leases(
  id text primary key,
  job_id text not null,
  worker text not null,
  acquired_at_ms integer not null,
  expires_at_ms integer not null
);
create index if not exists gateway_leases_expires on gateway_leases(expires_at_ms);

create table if not exists gateway_events(
  id text primary key,
  kind text not null,
  target text,
  state text not null,
  payload_json text not null,
  created_at_ms integer not null,
  updated_at_ms integer not null
);
create index if not exists gateway_events_state on gateway_events(state, updated_at_ms);

create table if not exists gateway_logs(
  id integer primary key autoincrement,
  at_ms integer not null,
  level text not null,
  target text,
  message text not null,
  data_json text
);
create index if not exists gateway_logs_target_id on gateway_logs(target, id);

create table if not exists gateway_services(
  name text primary key,
  spec_json text not null,
  status_json text not null,
  updated_at_ms integer not null
);

create table if not exists gateway_agent_runtimes(
  id text primary key,
  descriptor_json text not null,
  updated_at_ms integer not null
);
"#;

pub(crate) fn json_parse<T: for<'de> serde::Deserialize<'de>>(json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|error| error.to_string())
}

pub(crate) fn json_string(value: &impl Serialize) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

pub(crate) fn optional_json(value: Option<&Value>) -> Result<Option<String>, String> {
    value.map(json_string).transpose()
}
