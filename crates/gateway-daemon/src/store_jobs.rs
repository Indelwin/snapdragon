use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use snapdragon_gateway_core::{GatewayJobSpec, GatewayJobState, GatewayJobStatus};

use crate::{
    store::{GatewayStore, json_parse, json_string},
    store_job_leases::clear_job_leases_on,
    store_job_types::{
        final_job_state, finish_log_level, finish_log_message, job_log_data, job_state,
        pending_job_status,
    },
    store_leases::lease_on,
    store_workers::clear_worker_lease_on,
};

impl GatewayStore {
    pub fn enqueue_job(
        &self,
        id: String,
        spec: GatewayJobSpec,
        now_ms: u64,
    ) -> Result<GatewayJobStatus, String> {
        let status = self.with_immediate_transaction(|transaction| {
            if job_on(transaction, &id)?.is_some() {
                return Err(format!("gateway job id already exists: {id}"));
            }
            let status = pending_job_status(id, spec, now_ms);
            upsert_job_on(transaction, &status)?;
            Ok(status)
        })?;
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
        let status = self.with_immediate_transaction(|transaction| {
            let Some(mut status) = job_on(transaction, id)? else {
                return Ok(None);
            };
            clear_job_leases_on(transaction, id, now_ms)?;
            status.state = GatewayJobState::Cancelled;
            status.updated_at_ms = now_ms;
            status.lease_id = None;
            status.lease_attempt = None;
            status.lease_expires_at_ms = None;
            upsert_job_on(transaction, &status)?;
            Ok(Some(status))
        })?;
        if status.is_some() {
            let _ = self.append_log(now_ms, "warn", Some(id), "job cancelled", None);
        }
        Ok(status)
    }

    pub fn retry_job(&self, id: &str, now_ms: u64) -> Result<Option<GatewayJobStatus>, String> {
        let (status, retried) = self.with_immediate_transaction(|transaction| {
            let Some(mut status) = job_on(transaction, id)? else {
                return Ok((None, false));
            };
            if status.state != GatewayJobState::Failed {
                return Ok((Some(status), false));
            }
            clear_job_leases_on(transaction, id, now_ms)?;
            status.state = GatewayJobState::Pending;
            status.updated_at_ms = now_ms;
            status.result = None;
            status.lease_id = None;
            status.lease_attempt = None;
            status.lease_expires_at_ms = None;
            upsert_job_on(transaction, &status)?;
            Ok((Some(status), true))
        })?;
        if retried {
            let _ = self.append_log(now_ms, "info", Some(id), "job retry requested", None);
        }
        Ok(status)
    }

    pub fn complete_job(
        &self,
        id: &str,
        lease_id: &str,
        attempt: u32,
        result: Option<Value>,
        now_ms: u64,
    ) -> Result<Option<GatewayJobStatus>, String> {
        self.finish_job(
            id,
            lease_id,
            attempt,
            GatewayJobState::Completed,
            result,
            None,
            now_ms,
        )
    }

    pub fn fail_job(
        &self,
        id: &str,
        lease_id: &str,
        attempt: u32,
        error: String,
        now_ms: u64,
    ) -> Result<Option<GatewayJobStatus>, String> {
        self.finish_job(
            id,
            lease_id,
            attempt,
            GatewayJobState::Failed,
            None,
            Some(error),
            now_ms,
        )
    }

    fn finish_job(
        &self,
        id: &str,
        lease_id: &str,
        attempt: u32,
        state: GatewayJobState,
        result: Option<Value>,
        error: Option<String>,
        now_ms: u64,
    ) -> Result<Option<GatewayJobStatus>, String> {
        let status = self.with_immediate_transaction(|transaction| {
            let Some(mut status) = job_on(transaction, id)? else {
                return Ok(None);
            };
            validate_fence(&status, lease_id, attempt)?;
            let lease = lease_on(transaction, lease_id)?.ok_or_else(|| stale_fence_error(id))?;
            if lease.job_id != id || lease.attempt != attempt || lease.expires_at_ms <= now_ms {
                return Err(stale_fence_error(id));
            }
            let final_state = final_job_state(&status, state);
            status.state = final_state;
            status.updated_at_ms = now_ms;
            status.result = result;
            status.last_error = error.clone();
            status.lease_id = None;
            status.lease_attempt = None;
            status.lease_expires_at_ms = None;
            upsert_job_on(transaction, &status)?;
            clear_worker_lease_on(transaction, &lease, now_ms)?;
            transaction
                .execute("delete from gateway_leases where id=?1", params![lease.id])
                .map_err(|error| error.to_string())?;
            Ok(Some(status))
        })?;
        let Some(status) = status else {
            return Ok(None);
        };
        let _ = self.append_log(
            now_ms,
            finish_log_level(status.state),
            Some(id),
            finish_log_message(status.state, error.as_deref()),
            Some(job_log_data(&status)),
        );
        Ok(Some(status))
    }
}

pub(crate) fn job_on(conn: &Connection, id: &str) -> Result<Option<GatewayJobStatus>, String> {
    conn.query_row(
        "select status_json from gateway_jobs where id=?1",
        params![id],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| error.to_string())?
    .map(|json| json_parse(&json))
    .transpose()
}

pub(crate) fn upsert_job_on(conn: &Connection, status: &GatewayJobStatus) -> Result<(), String> {
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
}

pub(crate) fn validate_fence(
    status: &GatewayJobStatus,
    lease_id: &str,
    attempt: u32,
) -> Result<(), String> {
    if status.state != GatewayJobState::Running
        || status.lease_id.as_deref() != Some(lease_id)
        || status.lease_attempt != Some(attempt)
        || status.attempts != attempt
    {
        return Err(stale_fence_error(&status.id));
    }
    Ok(())
}

pub(crate) fn stale_fence_error(id: &str) -> String {
    format!("stale lease fence for gateway job {id}")
}
