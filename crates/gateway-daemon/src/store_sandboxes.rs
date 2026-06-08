use rusqlite::{Connection, OptionalExtension, params};
use snapdragon_gateway_core::GatewaySandboxLease;

use crate::store::{GatewayStore, json_parse, json_string};

pub(crate) fn init_sandbox_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SANDBOX_SCHEMA)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

impl GatewayStore {
    pub fn register_sandbox_lease(
        &self,
        lease: GatewaySandboxLease,
        now_ms: u64,
    ) -> Result<GatewaySandboxLease, String> {
        validate_lease(&lease)?;
        self.with_conn(|conn| {
            conn.execute(
                "insert into gateway_sandbox_leases(
                   id, sandbox_id, cwd, lease_json, acquired_at_ms, expires_at_ms
                 )
                 values(?1, ?2, ?3, ?4, ?5, ?6)
                 on conflict(id) do update set
                   sandbox_id=excluded.sandbox_id,
                   cwd=excluded.cwd,
                   lease_json=excluded.lease_json,
                   acquired_at_ms=excluded.acquired_at_ms,
                   expires_at_ms=excluded.expires_at_ms",
                params![
                    lease.id,
                    lease.sandbox_id,
                    lease.cwd,
                    json_string(&lease)?,
                    lease.acquired_at_ms,
                    lease.expires_at_ms,
                ],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
        })?;
        self.append_log(
            now_ms,
            "info",
            Some(&lease.id),
            "sandbox lease registered",
            None,
        )?;
        Ok(lease)
    }

    pub fn list_sandbox_leases(&self) -> Result<Vec<GatewaySandboxLease>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select lease_json from gateway_sandbox_leases
                     order by acquired_at_ms desc, id",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.map(|row| json_parse(&row.map_err(|error| error.to_string())?))
                .collect()
        })
    }

    pub fn sandbox_lease(&self, id: &str) -> Result<Option<GatewaySandboxLease>, String> {
        let id = validate_id("sandbox lease id", id)?;
        self.with_conn(|conn| {
            conn.query_row(
                "select lease_json from gateway_sandbox_leases where id=?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .map(|json| json_parse(&json))
            .transpose()
        })
    }

    pub fn release_sandbox_lease(
        &self,
        id: &str,
        now_ms: u64,
    ) -> Result<Option<GatewaySandboxLease>, String> {
        let Some(lease) = self.sandbox_lease(id)? else {
            return Ok(None);
        };
        self.with_conn(|conn| {
            conn.execute(
                "delete from gateway_sandbox_leases where id=?1",
                params![lease.id],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
        })?;
        self.append_log(
            now_ms,
            "info",
            Some(&lease.id),
            "sandbox lease released",
            None,
        )?;
        Ok(Some(lease))
    }

    pub fn expire_sandbox_leases(&self, now_ms: u64) -> Result<u64, String> {
        let expired = self.expired_sandbox_leases(now_ms)?;
        for lease in &expired {
            self.append_log(
                now_ms,
                "warn",
                Some(&lease.id),
                "sandbox lease expired",
                None,
            )?;
        }
        self.with_conn(|conn| {
            conn.execute(
                "delete from gateway_sandbox_leases
                 where expires_at_ms is not null and expires_at_ms <= ?1",
                params![now_ms],
            )
            .map(|count| count as u64)
            .map_err(|error| error.to_string())
        })
    }

    fn expired_sandbox_leases(&self, now_ms: u64) -> Result<Vec<GatewaySandboxLease>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select lease_json from gateway_sandbox_leases
                     where expires_at_ms is not null and expires_at_ms <= ?1
                     order by expires_at_ms, id",
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

const SANDBOX_SCHEMA: &str = r#"
create table if not exists gateway_sandbox_leases(
  id text primary key,
  sandbox_id text not null,
  cwd text not null,
  lease_json text not null,
  acquired_at_ms integer not null,
  expires_at_ms integer
);
create index if not exists gateway_sandbox_leases_expires on gateway_sandbox_leases(expires_at_ms);
"#;

fn validate_lease(lease: &GatewaySandboxLease) -> Result<(), String> {
    validate_id("sandbox lease id", &lease.id)?;
    validate_id("sandbox id", &lease.sandbox_id)?;
    non_empty("sandbox cwd", &lease.cwd)?;
    if let Some(project) = &lease.project {
        non_empty("sandbox project id", &project.id)?;
        non_empty("sandbox project root", &project.root)?;
    }
    for root in &lease.reference_roots {
        non_empty("sandbox reference root", root)?;
    }
    Ok(())
}

fn validate_id(field: &str, value: &str) -> Result<String, String> {
    let value = non_empty(field, value)?;
    if value.len() > 128 {
        return Err(format!("{field} must be 128 characters or fewer"));
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | ':'))
    {
        return Err(format!(
            "{field} must contain only letters, numbers, '.', '_', '-', or ':'"
        ));
    }
    Ok(value.to_string())
}

fn non_empty<'a>(field: &str, value: &'a str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{field} must be non-empty"));
    }
    Ok(value)
}
