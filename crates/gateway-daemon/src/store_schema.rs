use rusqlite::Connection;

use crate::store_schema_sql::{LEASE_FENCE_MIGRATION, SCHEMA};

pub(crate) fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA)
        .map_err(|error| error.to_string())?;
    ensure_column(
        conn,
        "gateway_leases",
        "attempt",
        "alter table gateway_leases add column attempt integer not null default 1",
    )?;
    conn.execute_batch(LEASE_FENCE_MIGRATION)
        .map_err(|error| error.to_string())
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    migration: &str,
) -> Result<(), String> {
    let mut statement = conn
        .prepare(&format!("pragma table_info({table})"))
        .map_err(|error| error.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    for existing in columns {
        if existing.map_err(|error| error.to_string())? == column {
            return Ok(());
        }
    }
    conn.execute_batch(migration)
        .map_err(|error| error.to_string())
}
