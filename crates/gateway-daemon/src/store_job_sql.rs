use rusqlite::{OptionalExtension, params};
use snapdragon_gateway_core::{GatewayJobStatus, GatewayLease};

use crate::{
    store::{GatewayStore, json_parse, json_string},
    store_job_types::job_state,
};

impl GatewayStore {
    pub(crate) fn upsert_job(&self, status: &GatewayJobStatus) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "insert into gateway_jobs(id, kind, queue, state, priority, status_json, updated_at_ms)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 on conflict(id) do update set
                   kind=excluded.kind,
                   queue=excluded.queue,
                   state=excluded.state,
                   priority=excluded.priority,
                   status_json=excluded.status_json,
                   updated_at_ms=excluded.updated_at_ms",
                params![
                    status.id,
                    status.spec.kind,
                    status.spec.queue,
                    job_state(&status.state),
                    status.spec.priority,
                    json_string(status)?,
                    status.updated_at_ms
                ],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
        })
    }

    pub(crate) fn delete_job_leases(&self, id: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("delete from gateway_leases where job_id=?1", params![id])
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    }

    pub(crate) fn next_pending_job(&self, queue: &str) -> Result<Option<GatewayJobStatus>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "select status_json from gateway_jobs
                 where queue=?1 and state='pending'
                 order by priority desc, updated_at_ms asc, id asc limit 1",
                params![queue],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .map(|json| json_parse(&json))
            .transpose()
        })
    }

    pub(crate) fn expired_running_jobs(
        &self,
        now_ms: u64,
    ) -> Result<Vec<GatewayJobStatus>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select status_json from gateway_jobs
                     where state='running'
                       and json_extract(status_json, '$.lease_expires_at_ms') <= ?1",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![now_ms], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.map(|row| json_parse(&row.map_err(|error| error.to_string())?))
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
