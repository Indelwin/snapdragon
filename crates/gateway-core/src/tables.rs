use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ActorId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TableAccess {
    Public,
    Protected,
    Private,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayTable {
    pub name: String,
    pub owner: ActorId,
    pub access: TableAccess,
    rows: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableSnapshot {
    pub name: String,
    pub owner: ActorId,
    pub access: TableAccess,
    pub rows: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TableRegistry {
    tables: BTreeMap<String, GatewayTable>,
}

impl TableRegistry {
    pub fn create(&mut self, name: impl Into<String>, owner: ActorId, access: TableAccess) -> bool {
        let name = name.into();
        if self.tables.contains_key(&name) {
            return false;
        }
        self.tables.insert(
            name.clone(),
            GatewayTable {
                name,
                owner,
                access,
                rows: BTreeMap::new(),
            },
        );
        true
    }

    pub fn put(
        &mut self,
        table: &str,
        caller: &ActorId,
        key: impl Into<String>,
        value: Value,
    ) -> Result<(), String> {
        let table = self
            .tables
            .get_mut(table)
            .ok_or_else(|| format!("table not found: {table}"))?;
        if table.access == TableAccess::Private && &table.owner != caller {
            return Err("private table write denied".into());
        }
        table.rows.insert(key.into(), value);
        Ok(())
    }

    pub fn get(&self, table: &str, caller: &ActorId, key: &str) -> Result<Option<Value>, String> {
        let table = self
            .tables
            .get(table)
            .ok_or_else(|| format!("table not found: {table}"))?;
        if table.access == TableAccess::Private && &table.owner != caller {
            return Err("private table read denied".into());
        }
        Ok(table.rows.get(key).cloned())
    }

    pub fn cleanup_owner(&mut self, owner: &ActorId) {
        self.tables.retain(|_, table| &table.owner != owner);
    }

    pub fn table_names(&self) -> Vec<String> {
        self.tables.keys().cloned().collect()
    }

    pub fn snapshot(&self, name: &str) -> Option<TableSnapshot> {
        self.tables.get(name).map(|table| TableSnapshot {
            name: table.name.clone(),
            owner: table.owner.clone(),
            access: table.access,
            rows: table.rows.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn private_table_rejects_non_owner_access_and_cleans_up_owner() {
        let mut tables = TableRegistry::default();
        let owner = ActorId::new("owner");
        let other = ActorId::new("other");
        assert!(tables.create("state", owner.clone(), TableAccess::Private));
        tables.put("state", &owner, "k", json!(1)).unwrap();
        assert!(tables.get("state", &other, "k").is_err());
        tables.cleanup_owner(&owner);
        assert!(tables.table_names().is_empty());
    }
}
