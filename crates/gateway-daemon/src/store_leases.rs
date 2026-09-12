use rusqlite::{Connection, params};
use snapdragon_gateway_core::GatewayLease;

pub(crate) fn lease_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GatewayLease> {
    Ok(GatewayLease {
        id: row.get(0)?,
        job_id: row.get(1)?,
        worker: row.get(2)?,
        attempt: row.get(3)?,
        acquired_at_ms: row.get(4)?,
        expires_at_ms: row.get(5)?,
    })
}

pub(crate) fn lease_on(conn: &Connection, id: &str) -> Result<Option<GatewayLease>, String> {
    use rusqlite::OptionalExtension;

    conn.query_row(
        "select id, job_id, worker, attempt, acquired_at_ms, expires_at_ms
         from gateway_leases where id=?1",
        params![id],
        lease_from_row,
    )
    .optional()
    .map_err(|error| error.to_string())
}
