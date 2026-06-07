use rusqlite::{OptionalExtension, params};
use serde_json::Value;
use snapdragon_gateway_core::{GatewayJobSpec, GatewayJobState, GatewayJobStatus, GatewayLease};

use crate::{
    store::{GatewayStore, json_parse, json_string},
    store_job_types::{expired_state, job_log_data, job_state, pending_job_status},
};

impl GatewayStore {
    pub fn enqueue_job(
        &self,
        id: String,
        spec: GatewayJobSpec,
        now_ms: u64,
    ) -> Result<GatewayJobStatus, String> {
        let status = pending_job_status(id, spec, now_ms);
        self.upsert_job(&status)?;
        self.append_log(
            now_ms,
            "info",
            Some(&status.id),
            "job enqueued",
            Some(job_log_data(&status)),
        )?;
        Ok(status)
    }

    pub fn list_jobs(&self) -> Result<Vec<GatewayJobStatus>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("select status_json from gateway_jobs order by updated_at_ms desc, id")
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.map(|row| json_parse(&row.map_err(|error| error.to_string())?))
                .collect()
        })
    }

    pub fn job(&self, id: &str) -> Result<Option<GatewayJobStatus>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "select status_json from gateway_jobs where id=?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .map(|json| json_parse(&json))
            .transpose()
        })
    }

    pub fn cancel_job(&self, id: &str, now_ms: u64) -> Result<Option<GatewayJobStatus>, String> {
        let Some(mut status) = self.job(id)? else {
            return Ok(None);
        };
        let leases = self.job_leases(id)?;
        status.state = GatewayJobState::Cancelled;
        status.updated_at_ms = now_ms;
        status.lease_id = None;
        status.lease_expires_at_ms = None;
        self.upsert_job(&status)?;
        self.clear_worker_leases(&leases, now_ms)?;
        self.delete_job_leases(id)?;
        self.append_log(now_ms, "warn", Some(id), "job cancelled", None)?;
        Ok(Some(status))
    }

    pub fn complete_job(
        &self,
        id: &str,
        result: Option<Value>,
        now_ms: u64,
    ) -> Result<Option<GatewayJobStatus>, String> {
        self.finish_job(id, GatewayJobState::Completed, result, None, now_ms)
    }

    pub fn fail_job(
        &self,
        id: &str,
        error: String,
        now_ms: u64,
    ) -> Result<Option<GatewayJobStatus>, String> {
        self.finish_job(id, GatewayJobState::Failed, None, Some(error), now_ms)
    }

    pub fn acquire_job(
        &self,
        queue: &str,
        worker: &str,
        lease_ms: u64,
        now_ms: u64,
    ) -> Result<Option<(GatewayJobStatus, GatewayLease)>, String> {
        let Some(mut status) = self.next_pending_job(queue)? else {
            return Ok(None);
        };
        let lease = GatewayLease {
            id: format!("lease_{now_ms}_{}", status.id),
            job_id: status.id.clone(),
            worker: worker.to_string(),
            acquired_at_ms: now_ms,
            expires_at_ms: now_ms.saturating_add(lease_ms),
        };
        status.state = GatewayJobState::Running;
        status.attempts = status.attempts.saturating_add(1);
        status.updated_at_ms = now_ms;
        status.lease_id = Some(lease.id.clone());
        status.lease_expires_at_ms = Some(lease.expires_at_ms);
        self.upsert_job(&status)?;
        self.upsert_lease(&lease)?;
        self.mark_worker_leased(worker, queue, &lease, now_ms)?;
        self.append_log(now_ms, "info", Some(&status.id), "job leased", None)?;
        Ok(Some((status, lease)))
    }

    pub fn expire_leases(&self, now_ms: u64) -> Result<u64, String> {
        for mut status in self.expired_running_jobs(now_ms)? {
            let leases = self.job_leases(&status.id)?;
            status.state = expired_state(&status);
            status.updated_at_ms = now_ms;
            status.last_error = Some("lease expired".into());
            status.lease_id = None;
            status.lease_expires_at_ms = None;
            self.upsert_job(&status)?;
            self.clear_worker_leases(&leases, now_ms)?;
            self.append_log(now_ms, "warn", Some(&status.id), "job lease expired", None)?;
        }
        self.with_conn(|conn| {
            conn.execute(
                "delete from gateway_leases where expires_at_ms <= ?1",
                params![now_ms],
            )
            .map(|count| count as u64)
            .map_err(|error| error.to_string())
        })
    }

    fn upsert_job(&self, status: &GatewayJobStatus) -> Result<(), String> {
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

    fn finish_job(
        &self,
        id: &str,
        state: GatewayJobState,
        result: Option<Value>,
        error: Option<String>,
        now_ms: u64,
    ) -> Result<Option<GatewayJobStatus>, String> {
        let Some(mut status) = self.job(id)? else {
            return Ok(None);
        };
        if status.state == GatewayJobState::Cancelled {
            return Ok(Some(status));
        }
        status.state = state;
        status.updated_at_ms = now_ms;
        status.result = result;
        status.last_error = error;
        status.lease_id = None;
        status.lease_expires_at_ms = None;
        let leases = self.job_leases(id)?;
        self.upsert_job(&status)?;
        self.clear_worker_leases(&leases, now_ms)?;
        self.delete_job_leases(id)?;
        self.append_log(
            now_ms,
            "info",
            Some(id),
            "job finished",
            Some(job_log_data(&status)),
        )?;
        Ok(Some(status))
    }

    fn next_pending_job(&self, queue: &str) -> Result<Option<GatewayJobStatus>, String> {
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

    fn expired_running_jobs(&self, now_ms: u64) -> Result<Vec<GatewayJobStatus>, String> {
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
}
