use rusqlite::{OptionalExtension, params};
use snapdragon_gateway_core::{GatewayAgentRuntimeDescriptor, validate_agent_runtime_id};

use crate::store::{GatewayStore, json_parse, json_string};

impl GatewayStore {
    pub fn persist_agent_runtime(
        &self,
        descriptor: &GatewayAgentRuntimeDescriptor,
        updated_at_ms: u64,
    ) -> Result<GatewayAgentRuntimeDescriptor, String> {
        descriptor.validate()?;
        let json = json_string(descriptor)?;
        self.with_conn(|conn| {
            conn.execute(
                "insert into gateway_agent_runtimes(id, descriptor_json, updated_at_ms)
                 values(?1, ?2, ?3)
                 on conflict(id) do update set
                   descriptor_json=excluded.descriptor_json,
                   updated_at_ms=excluded.updated_at_ms",
                (&descriptor.id, json, updated_at_ms),
            )
            .map_err(|error| error.to_string())?;
            Ok(descriptor.clone())
        })
    }

    pub fn agent_runtime_snapshots(&self) -> Result<Vec<GatewayAgentRuntimeDescriptor>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("select descriptor_json from gateway_agent_runtimes order by id")
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?;
            rows.map(|row| json_parse(&row.map_err(|error| error.to_string())?))
                .collect()
        })
    }

    pub fn remove_agent_runtime(
        &self,
        id: &str,
    ) -> Result<Option<GatewayAgentRuntimeDescriptor>, String> {
        let id = validate_agent_runtime_id(id)?;
        self.with_conn(|conn| {
            let json = conn
                .query_row(
                    "select descriptor_json from gateway_agent_runtimes where id=?1",
                    params![id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if json.is_some() {
                conn.execute(
                    "delete from gateway_agent_runtimes where id=?1",
                    params![id],
                )
                .map_err(|error| error.to_string())?;
            }
            json.map(|value| json_parse(&value)).transpose()
        })
    }
}
