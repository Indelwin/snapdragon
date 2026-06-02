use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewayProjectRef {
    pub id: String,
    pub root: String,
    #[serde(default)]
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewaySandboxBackend {
    Worktree,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewaySandboxSpec {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub lease_id: Option<String>,
    #[serde(default)]
    pub sandbox_id: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    pub project: GatewayProjectRef,
    #[serde(default)]
    pub backend: Option<GatewaySandboxBackend>,
    #[serde(default)]
    pub reference_roots: Vec<String>,
    #[serde(default)]
    pub inherit_env: bool,
    #[serde(default)]
    pub ttl_ms: Option<u64>,
    #[serde(default)]
    pub expires_at_ms: Option<u64>,
    #[serde(default)]
    pub acquired_at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GatewaySandboxLease {
    pub id: String,
    pub sandbox_id: String,
    pub cwd: String,
    pub acquired_at_ms: u64,
    #[serde(default)]
    pub expires_at_ms: Option<u64>,
    #[serde(default)]
    pub backend: Option<GatewaySandboxBackend>,
    #[serde(default)]
    pub project: Option<GatewayProjectRef>,
    #[serde(default)]
    pub reference_roots: Vec<String>,
}

impl GatewaySandboxSpec {
    pub fn into_lease(self, now_ms: u64) -> Result<GatewaySandboxLease, String> {
        let default_id = format!("sandbox_{now_ms}");
        let sandbox_id = validate_sandbox_id(
            self.sandbox_id
                .as_deref()
                .or(self.id.as_deref())
                .unwrap_or(&default_id),
        )?;
        let lease_id = self
            .lease_id
            .unwrap_or_else(|| format!("lease_{sandbox_id}"));
        let expires_at_ms = self
            .expires_at_ms
            .or_else(|| self.ttl_ms.map(|ttl| now_ms.saturating_add(ttl)));
        if expires_at_ms
            .map(|expires| expires <= now_ms)
            .unwrap_or(false)
        {
            return Err("gateway sandbox lease expiry must be in the future".into());
        }
        Ok(GatewaySandboxLease {
            id: validate_sandbox_id(&lease_id)?,
            sandbox_id,
            cwd: non_empty("cwd", self.cwd.as_deref().unwrap_or(&self.project.root))?,
            acquired_at_ms: self.acquired_at_ms.unwrap_or(now_ms),
            expires_at_ms,
            backend: Some(self.backend.unwrap_or(GatewaySandboxBackend::Worktree)),
            project: Some(GatewayProjectRef {
                root: non_empty("project.root", &self.project.root)?,
                ..self.project
            }),
            reference_roots: self
                .reference_roots
                .iter()
                .map(|root| non_empty("reference_roots", root))
                .collect::<Result<Vec<_>, _>>()?,
        })
    }
}

fn validate_sandbox_id(value: &str) -> Result<String, String> {
    let id = non_empty("id", value)?;
    let mut chars = id.chars();
    let Some(first) = chars.next() else {
        return Err("gateway sandbox id must be non-empty".into());
    };
    if !first.is_ascii_alphanumeric()
        || chars.any(|value| {
            !(value.is_ascii_alphanumeric()
                || value == '.'
                || value == '_'
                || value == '-'
                || value == ':')
        })
    {
        return Err(
            "gateway sandbox id must start with a letter or number and contain only letters, numbers, '.', '_', '-', or ':'"
                .into(),
        );
    }
    Ok(id)
}

fn non_empty(field: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("gateway sandbox {field} must be non-empty"));
    }
    Ok(value.into())
}
