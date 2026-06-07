use rusqlite::{OptionalExtension, params};
use snapdragon_gateway_core::{
    GatewayLease, GatewayWorkerHeartbeat, GatewayWorkerRecord, GatewayWorkerRegistration,
    GatewayWorkerState, validate_worker_id,
};

use crate::store::{GatewayStore, json_parse, json_string};

impl GatewayStore {
    pub fn register_worker(
        &self,
        registration: GatewayWorkerRegistration,
        now_ms: u64,
    ) -> Result<GatewayWorkerRecord, String> {
        let mut record = registration.into_record(now_ms)?;
        if let Some(existing) = self.worker(&record.id)? {
            record.registered_at_ms = existing.registered_at_ms;
            record.current_job_id = existing.current_job_id;
            record.current_lease_id = existing.current_lease_id;
            record.lease_expires_at_ms = existing.lease_expires_at_ms;
            record.last_error = existing.last_error;
        }
        self.upsert_worker(&record)?;
        self.append_log(now_ms, "info", Some(&record.id), "worker registered", None)?;
        Ok(record)
    }

    pub fn heartbeat_worker(
        &self,
        heartbeat: GatewayWorkerHeartbeat,
        now_ms: u64,
    ) -> Result<Option<GatewayWorkerRecord>, String> {
        let Some(mut record) = self.worker(&heartbeat.id)? else {
            return Ok(None);
        };
        if let Some(state) = heartbeat.state {
            record.state = state;
        }
        if let Some(queue) = heartbeat.queue {
            record.queue = worker_field("queue", &queue)?;
        }
        record.status = heartbeat.status.or(record.status);
        record.last_error = heartbeat.last_error.or(record.last_error);
        record.metadata = heartbeat.metadata.or(record.metadata);
        record.heartbeat_at_ms = now_ms;
        self.upsert_worker(&record)?;
        Ok(Some(record))
    }

    pub fn list_workers(&self) -> Result<Vec<GatewayWorkerRecord>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select worker_json from gateway_workers order by heartbeat_at_ms desc, id",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.map(|row| json_parse(&row.map_err(|error| error.to_string())?))
                .collect()
        })
    }

    pub fn worker(&self, id: &str) -> Result<Option<GatewayWorkerRecord>, String> {
        let id = validate_worker_id(id)?;
        self.with_conn(|conn| {
            conn.query_row(
                "select worker_json from gateway_workers where id=?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .map(|json| json_parse(&json))
            .transpose()
        })
    }

    pub(crate) fn mark_worker_leased(
        &self,
        worker: &str,
        queue: &str,
        lease: &GatewayLease,
        now_ms: u64,
    ) -> Result<(), String> {
        let mut record = self
            .worker(worker)?
            .unwrap_or_else(|| worker_from_lease(worker, queue, now_ms));
        record.queue = worker_field("queue", queue)?;
        record.state = GatewayWorkerState::Running;
        record.current_job_id = Some(lease.job_id.clone());
        record.current_lease_id = Some(lease.id.clone());
        record.lease_expires_at_ms = Some(lease.expires_at_ms);
        record.heartbeat_at_ms = now_ms;
        self.upsert_worker(&record)
    }

    pub(crate) fn clear_worker_lease(
        &self,
        lease: &GatewayLease,
        now_ms: u64,
    ) -> Result<(), String> {
        let Some(mut record) = self.worker(&lease.worker)? else {
            return Ok(());
        };
        if record.current_lease_id.as_deref() != Some(&lease.id) {
            return Ok(());
        }
        record.state = GatewayWorkerState::Idle;
        record.current_job_id = None;
        record.current_lease_id = None;
        record.lease_expires_at_ms = None;
        record.heartbeat_at_ms = now_ms;
        self.upsert_worker(&record)
    }

    fn upsert_worker(&self, record: &GatewayWorkerRecord) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "insert into gateway_workers(id, queue, state, worker_json, heartbeat_at_ms)
                 values(?1, ?2, ?3, ?4, ?5)
                 on conflict(id) do update set
                   queue=excluded.queue,
                   state=excluded.state,
                   worker_json=excluded.worker_json,
                   heartbeat_at_ms=excluded.heartbeat_at_ms",
                params![
                    record.id,
                    record.queue,
                    worker_state(&record.state),
                    json_string(record)?,
                    record.heartbeat_at_ms
                ],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
        })
    }
}

fn worker_from_lease(worker: &str, queue: &str, now_ms: u64) -> GatewayWorkerRecord {
    GatewayWorkerRecord {
        id: worker.to_string(),
        queue: queue.to_string(),
        runtime_id: None,
        service: None,
        capabilities: Vec::new(),
        state: GatewayWorkerState::Idle,
        registered_at_ms: now_ms,
        heartbeat_at_ms: now_ms,
        current_job_id: None,
        current_lease_id: None,
        lease_expires_at_ms: None,
        status: None,
        last_error: None,
        metadata: None,
    }
}

fn worker_field(field: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("gateway worker {field} must be non-empty"));
    }
    Ok(value.to_string())
}

fn worker_state(state: &GatewayWorkerState) -> &'static str {
    match state {
        GatewayWorkerState::Idle => "idle",
        GatewayWorkerState::Running => "running",
        GatewayWorkerState::Offline => "offline",
    }
}
