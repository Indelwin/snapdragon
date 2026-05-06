use rusqlite::params;
use snapdragon_gateway_core::{GatewayLease, GatewayLogRecord, GatewayQueueDepth};

use crate::GatewayStore;
use crate::store_events::log_from_row;

impl GatewayStore {
    pub fn active_leases(&self, now_ms: u64) -> Result<Vec<GatewayLease>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select id, job_id, worker, acquired_at_ms, expires_at_ms
                     from gateway_leases where expires_at_ms > ?1 order by expires_at_ms, id",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![now_ms], lease_from_row)
                .map_err(|error| error.to_string())?;
            rows.map(|row| row.map_err(|error| error.to_string()))
                .collect()
        })
    }

    pub fn queue_depths(&self) -> Result<Vec<GatewayQueueDepth>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select queue,
                            sum(case when state='pending' then 1 else 0 end),
                            sum(case when state='running' then 1 else 0 end)
                     from gateway_jobs group by queue order by queue",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], queue_depth_from_row)
                .map_err(|error| error.to_string())?;
            rows.map(|row| row.map_err(|error| error.to_string()))
                .collect()
        })
    }

    pub fn recent_failures(&self, limit: u64) -> Result<Vec<GatewayLogRecord>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select id, at_ms, level, target, message, data_json from gateway_logs
                     where level in ('error', 'warn') order by id desc limit ?1",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![limit], log_from_row)
                .map_err(|error| error.to_string())?;
            let mut logs = rows
                .map(|row| row.map_err(|error| error.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            logs.reverse();
            Ok(logs)
        })
    }
}

fn lease_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GatewayLease> {
    Ok(GatewayLease {
        id: row.get(0)?,
        job_id: row.get(1)?,
        worker: row.get(2)?,
        acquired_at_ms: row.get(3)?,
        expires_at_ms: row.get(4)?,
    })
}

fn queue_depth_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GatewayQueueDepth> {
    Ok(GatewayQueueDepth {
        queue: row.get(0)?,
        pending: row.get::<_, u64>(1)?,
        running: row.get::<_, u64>(2)?,
    })
}
