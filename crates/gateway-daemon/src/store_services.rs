use rusqlite::params;
use snapdragon_gateway_core::{ServiceSpec, ServiceStatus};

use crate::store::{GatewayStore, json_parse, json_string};

impl GatewayStore {
    pub fn persist_service(
        &self,
        spec: &ServiceSpec,
        status: &ServiceStatus,
        at_ms: u64,
    ) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "insert into gateway_services(name, spec_json, status_json, updated_at_ms)
                 values (?1, ?2, ?3, ?4)
                 on conflict(name) do update set
                   spec_json=excluded.spec_json,
                   status_json=excluded.status_json,
                   updated_at_ms=excluded.updated_at_ms",
                params![spec.name, json_string(spec)?, json_string(status)?, at_ms],
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
        })
    }

    pub fn service_snapshots(&self) -> Result<Vec<(ServiceSpec, ServiceStatus)>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("select spec_json, status_json from gateway_services order by name")
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| error.to_string())?;
            rows.map(|row| {
                let (spec, status) = row.map_err(|error| error.to_string())?;
                Ok((json_parse(&spec)?, json_parse(&status)?))
            })
            .collect()
        })
    }
}
