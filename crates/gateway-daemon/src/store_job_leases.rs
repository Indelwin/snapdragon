use rusqlite::{Connection, params};
use snapdragon_gateway_core::{
    GatewayJobState, GatewayJobStatus, GatewayLease, validate_worker_id,
};

use crate::{
    store::GatewayStore,
    store_job_types::{expired_state, job_log_data},
    store_jobs::{job_on, stale_fence_error, upsert_job_on, validate_fence},
    store_leases::{lease_from_row, lease_on},
    store_workers::{clear_worker_lease_on, ensure_worker_available_on, mark_worker_leased_on},
};

impl GatewayStore {
    pub fn acquire_job(
        &self,
        queue: &str,
        worker: &str,
        lease_ms: u64,
        now_ms: u64,
    ) -> Result<Option<(GatewayJobStatus, GatewayLease)>, String> {
        let worker = validate_worker_id(worker)?;
        let acquired = self.with_immediate_transaction(|transaction| {
            ensure_worker_available_on(transaction, &worker)?;
            let Some(mut status) = next_pending_job_on(transaction, queue)? else {
                return Ok(None);
            };
            let attempt = status.attempts.saturating_add(1);
            let lease = GatewayLease {
                id: format!("lease_{}_{}_{}", status.id, attempt, now_ms),
                job_id: status.id.clone(),
                worker: worker.clone(),
                attempt,
                acquired_at_ms: now_ms,
                expires_at_ms: now_ms.saturating_add(lease_ms),
            };
            status.state = GatewayJobState::Running;
            status.attempts = attempt;
            status.updated_at_ms = now_ms;
            status.lease_id = Some(lease.id.clone());
            status.lease_attempt = Some(attempt);
            status.lease_expires_at_ms = Some(lease.expires_at_ms);
            upsert_job_on(transaction, &status)?;
            upsert_lease_on(transaction, &lease)?;
            mark_worker_leased_on(transaction, &worker, queue, &lease, now_ms)?;
            Ok(Some((status, lease)))
        })?;
        if let Some((status, _)) = &acquired {
            let _ = self.append_log(
                now_ms,
                "info",
                Some(&status.id),
                "job leased",
                Some(job_log_data(status)),
            );
        }
        Ok(acquired)
    }

    pub fn renew_job(
        &self,
        id: &str,
        lease_id: &str,
        attempt: u32,
        lease_ms: u64,
        now_ms: u64,
    ) -> Result<Option<(GatewayJobStatus, GatewayLease)>, String> {
        self.with_immediate_transaction(|transaction| {
            let Some(mut status) = job_on(transaction, id)? else {
                return Ok(None);
            };
            validate_fence(&status, lease_id, attempt)?;
            let Some(mut lease) = lease_on(transaction, lease_id)? else {
                return Err(stale_fence_error(id));
            };
            if lease.job_id != id || lease.attempt != attempt || lease.expires_at_ms <= now_ms {
                return Err(stale_fence_error(id));
            }
            lease.expires_at_ms = now_ms.saturating_add(lease_ms);
            status.updated_at_ms = now_ms;
            status.lease_expires_at_ms = Some(lease.expires_at_ms);
            upsert_job_on(transaction, &status)?;
            upsert_lease_on(transaction, &lease)?;
            mark_worker_leased_on(
                transaction,
                &lease.worker,
                &status.spec.queue,
                &lease,
                now_ms,
            )?;
            Ok(Some((status, lease)))
        })
    }

    pub fn expire_leases(&self, now_ms: u64) -> Result<u64, String> {
        let expired = self.with_immediate_transaction(|transaction| {
            let leases = expired_leases_on(transaction, now_ms)?;
            let mut statuses = Vec::new();
            for lease in &leases {
                if let Some(status) = expire_lease_on(transaction, lease, now_ms)? {
                    statuses.push(status);
                }
            }
            Ok(statuses)
        })?;
        for status in &expired {
            let _ = self.append_log(now_ms, "warn", Some(&status.id), "job lease expired", None);
        }
        Ok(expired.len() as u64)
    }
}

fn next_pending_job_on(conn: &Connection, queue: &str) -> Result<Option<GatewayJobStatus>, String> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "select status_json from gateway_jobs
         where queue=?1 and state='pending'
         order by priority desc, updated_at_ms asc, id asc limit 1",
        params![queue],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| error.to_string())?
    .map(|json| crate::store::json_parse(&json))
    .transpose()
}

fn upsert_lease_on(conn: &Connection, lease: &GatewayLease) -> Result<(), String> {
    conn.execute(
        "insert into gateway_leases(id, job_id, worker, attempt, acquired_at_ms, expires_at_ms)
         values (?1, ?2, ?3, ?4, ?5, ?6)
         on conflict(id) do update set expires_at_ms=excluded.expires_at_ms",
        params![
            lease.id,
            lease.job_id,
            lease.worker,
            lease.attempt,
            lease.acquired_at_ms,
            lease.expires_at_ms
        ],
    )
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn expired_leases_on(conn: &Connection, now_ms: u64) -> Result<Vec<GatewayLease>, String> {
    let mut statement = conn
        .prepare(
            "select id, job_id, worker, attempt, acquired_at_ms, expires_at_ms
             from gateway_leases where expires_at_ms <= ?1 order by expires_at_ms, id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![now_ms], lease_from_row)
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

fn expire_lease_on(
    conn: &Connection,
    lease: &GatewayLease,
    now_ms: u64,
) -> Result<Option<GatewayJobStatus>, String> {
    let Some(mut status) = job_on(conn, &lease.job_id)? else {
        delete_lease_on(conn, &lease.id)?;
        return Ok(None);
    };
    if validate_fence(&status, &lease.id, lease.attempt).is_err() {
        clear_worker_lease_on(conn, lease, now_ms)?;
        delete_lease_on(conn, &lease.id)?;
        if status.state != GatewayJobState::Running
            || status.lease_id.as_deref() != Some(lease.id.as_str())
        {
            return Ok(None);
        }
        status.last_error = Some("lease fence was inconsistent at expiry".into());
    } else {
        status.last_error = Some("lease expired".into());
    }
    status.state = expired_state(&status);
    status.updated_at_ms = now_ms;
    status.lease_id = None;
    status.lease_attempt = None;
    status.lease_expires_at_ms = None;
    upsert_job_on(conn, &status)?;
    clear_worker_lease_on(conn, lease, now_ms)?;
    delete_lease_on(conn, &lease.id)?;
    Ok(Some(status))
}

fn delete_lease_on(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("delete from gateway_leases where id=?1", params![id])
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) fn clear_job_leases_on(conn: &Connection, id: &str, now_ms: u64) -> Result<(), String> {
    let leases = {
        let mut statement = conn
            .prepare(
                "select id, job_id, worker, attempt, acquired_at_ms, expires_at_ms
                 from gateway_leases where job_id=?1 order by id",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![id], lease_from_row)
            .map_err(|error| error.to_string())?;
        rows.map(|row| row.map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()?
    };
    for lease in &leases {
        clear_worker_lease_on(conn, lease, now_ms)?;
    }
    conn.execute("delete from gateway_leases where job_id=?1", params![id])
        .map(|_| ())
        .map_err(|error| error.to_string())
}
