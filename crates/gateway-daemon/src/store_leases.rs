use rusqlite::params;
use snapdragon_gateway_core::GatewayLease;

use crate::store::GatewayStore;

impl GatewayStore {
    pub(crate) fn clear_worker_leases(
        &self,
        leases: &[GatewayLease],
        now_ms: u64,
    ) -> Result<(), String> {
        for lease in leases {
            self.clear_worker_lease(lease, now_ms)?;
        }
        Ok(())
    }

    pub(crate) fn delete_job_leases(&self, id: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("delete from gateway_leases where job_id=?1", params![id])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    }

    pub(crate) fn job_leases(&self, id: &str) -> Result<Vec<GatewayLease>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select id, job_id, worker, acquired_at_ms, expires_at_ms
                     from gateway_leases where job_id=?1 order by id",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![id], lease_from_row)
                .map_err(|error| error.to_string())?;
            rows.map(|row| row.map_err(|error| error.to_string()))
                .collect()
        })
    }

    pub(crate) fn upsert_lease(&self, lease: &GatewayLease) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "insert into gateway_leases(id, job_id, worker, acquired_at_ms, expires_at_ms)
                 values (?1, ?2, ?3, ?4, ?5)
                 on conflict(id) do update set expires_at_ms=excluded.expires_at_ms",
                params![
                    lease.id,
                    lease.job_id,
                    lease.worker,
                    lease.acquired_at_ms,
                    lease.expires_at_ms
                ],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
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
