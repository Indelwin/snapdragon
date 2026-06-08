use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use crate::store_sandboxes::init_sandbox_schema;
use crate::store_schema::init_schema;

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
            init_schema(conn)?;
            init_sandbox_schema(conn)
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

pub(crate) fn json_parse<T: for<'de> serde::Deserialize<'de>>(json: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|error| error.to_string())
}

pub(crate) fn json_string(value: &impl Serialize) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

pub(crate) fn optional_json(value: Option<&Value>) -> Result<Option<String>, String> {
    value.map(json_string).transpose()
}
