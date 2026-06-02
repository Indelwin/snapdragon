use rusqlite::{OptionalExtension, params};
use snapdragon_gateway_core::{GatewaySandboxLease, GatewaySandboxSpec};

use crate::store::{GatewayStore, json_parse, json_string};

pub(crate) const SANDBOX_SCHEMA: &str = r#"
create table if not exists gateway_sandbox_leases(
  id text primary key,
  sandbox_id text not null,
  cwd text not null,
  expires_at_ms integer,
  lease_json text not null,
  updated_at_ms integer not null
);
create index if not exists gateway_sandbox_leases_expires on gateway_sandbox_leases(expires_at_ms);
"#;

impl GatewayStore {
    pub fn lease_sandbox(
        &self,
        spec: GatewaySandboxSpec,
        now_ms: u64,
    ) -> Result<GatewaySandboxLease, String> {
        let lease = spec.into_lease(now_ms)?;
        let json = json_string(&lease)?;
        self.with_conn(|conn| {
            conn.execute(
                "insert into gateway_sandbox_leases(id, sandbox_id, cwd, expires_at_ms, lease_json, updated_at_ms)
                 values(?1, ?2, ?3, ?4, ?5, ?6)
                 on conflict(id) do update set
                   sandbox_id=excluded.sandbox_id,
                   cwd=excluded.cwd,
                   expires_at_ms=excluded.expires_at_ms,
                   lease_json=excluded.lease_json,
                   updated_at_ms=excluded.updated_at_ms",
                params![
                    &lease.id,
                    &lease.sandbox_id,
                    &lease.cwd,
                    lease.expires_at_ms,
                    json,
                    now_ms
                ],
            )
            .map_err(|error| error.to_string())?;
            Ok(())
        })?;
        self.append_log(
            now_ms,
            "info",
            Some(&lease.id),
            "sandbox lease acquired",
            None,
        )?;
        Ok(lease)
    }

    pub fn sandbox_lease(
        &self,
        id: &str,
        now_ms: u64,
    ) -> Result<Option<GatewaySandboxLease>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "select lease_json from gateway_sandbox_leases
                 where id=?1 and (expires_at_ms is null or expires_at_ms > ?2)",
                params![id, now_ms],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .map(|json| json_parse(&json))
            .transpose()
        })
    }

    pub fn sandbox_leases(&self, now_ms: u64) -> Result<Vec<GatewaySandboxLease>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "select lease_json from gateway_sandbox_leases
                     where expires_at_ms is null or expires_at_ms > ?1
                     order by id",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![now_ms], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.map(|row| json_parse(&row.map_err(|error| error.to_string())?))
                .collect()
        })
    }

    pub fn release_sandbox(
        &self,
        id: &str,
        now_ms: u64,
    ) -> Result<Option<GatewaySandboxLease>, String> {
        let lease = self.sandbox_lease(id, now_ms)?;
        if lease.is_some() {
            self.with_conn(|conn| {
                conn.execute(
                    "delete from gateway_sandbox_leases where id=?1",
                    params![id],
                )
                .map_err(|error| error.to_string())?;
                Ok(())
            })?;
            self.append_log(now_ms, "info", Some(id), "sandbox lease released", None)?;
        }
        Ok(lease)
    }
}
