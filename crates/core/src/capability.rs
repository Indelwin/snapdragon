//! Typed helpers for specific capabilities, routed through `HostPipe`.
//!
//! Capabilities are named versioned protocols the agent reaches for via
//! the host. Schemas live in `capabilities/` (repo root). This module
//! is mechanical glue — serialise request, call host, deserialise
//! response. `HostPipe` handles the actual transport (WIT in prod,
//! in-memory in tests).

use serde::{Deserialize, Serialize};

use crate::host::{CallError, HostPipe};

/// Canonical capability names known to core. Host-registered
/// capabilities (tool.invoke:*, memory.*, hooks, custom systems) use
/// string names directly; this enum is just for the handful core
/// itself reaches for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityName {
    LlmChat,            // "llm.chat@1" — also available as typed chat()
    BundleFetch,        // "bundle.fetch@1"
    ProfileGet,         // "profile.get@1"
    ScheduleResolve,    // "schedule.resolve@1"
    ToolList,           // "tool.list@1"
    MemoryPrefetch,     // "memory.prefetch@1"
    MemoryWrite,        // "memory.write@1"
    MemorySystemBlock,  // "memory.system_block@1"
    SkillList,          // "skill.list@1"
    SkillLoad,          // "skill.load@1"
    ContextCompress,    // "context.compress@1"
    ExecRun,            // "exec.run@1"
    RuntimePushContext, // "runtime.push_context@1"
    RuntimePopContext,  // "runtime.pop_context@1"
}

impl CapabilityName {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LlmChat => "llm.chat@1",
            Self::BundleFetch => "bundle.fetch@1",
            Self::ProfileGet => "profile.get@1",
            Self::ScheduleResolve => "schedule.resolve@1",
            Self::ToolList => "tool.list@1",
            Self::MemoryPrefetch => "memory.prefetch@1",
            Self::MemoryWrite => "memory.write@1",
            Self::MemorySystemBlock => "memory.system_block@1",
            Self::SkillList => "skill.list@1",
            Self::SkillLoad => "skill.load@1",
            Self::ContextCompress => "context.compress@1",
            Self::ExecRun => "exec.run@1",
            Self::RuntimePushContext => "runtime.push_context@1",
            Self::RuntimePopContext => "runtime.pop_context@1",
        }
    }
}

/// Typed call: serialise `request`, hit `host.call_capability`,
/// deserialise the response. The response JSON `{}` is a valid empty
/// response for any capability whose schema makes all fields optional.
pub fn call<Req: Serialize, Resp: for<'de> Deserialize<'de>>(
    host: &dyn HostPipe,
    cap: &str,
    req: &Req,
) -> Result<Resp, CallError> {
    let req_json = serde_json::to_string(req).map_err(|e| CallError::Serde(e.to_string()))?;
    let resp_json = host.call_capability(cap, &req_json)?;
    serde_json::from_str::<Resp>(&resp_json).map_err(|e| CallError::Serde(e.to_string()))
}

// ---- Typed wrappers for specific capabilities --------------------------

pub mod bundle {
    //! Typed helpers for `bundle.fetch@1`.
    use super::{CallError, CapabilityName, HostPipe, call};
    use alloc::string::String;
    use alloc::vec::Vec;
    use serde::{Deserialize, Serialize};

    #[derive(Serialize)]
    pub struct FetchRequest<'a> {
        pub cid: &'a str,
    }

    #[derive(Deserialize)]
    pub struct FetchResponse {
        pub bytes_b64: String,
    }

    pub fn fetch(host: &dyn HostPipe, cid: &str) -> Result<Vec<u8>, CallError> {
        let resp: FetchResponse = call(
            host,
            CapabilityName::BundleFetch.as_str(),
            &FetchRequest { cid },
        )?;
        decode_b64(&resp.bytes_b64).map_err(CallError::Host)
    }

    fn decode_b64(s: &str) -> Result<Vec<u8>, String> {
        let s = s.as_bytes();
        let mut out = Vec::with_capacity(s.len() * 3 / 4);
        let mut buf: u32 = 0;
        let mut bits = 0u32;
        for &c in s {
            let v: u32 = match c {
                b'A'..=b'Z' => (c - b'A') as u32,
                b'a'..=b'z' => (c - b'a' + 26) as u32,
                b'0'..=b'9' => (c - b'0' + 52) as u32,
                b'+' | b'-' => 62,
                b'/' | b'_' => 63,
                b'=' | b'\n' | b'\r' | b' ' => continue,
                _ => return Err(alloc::format!("invalid base64 byte 0x{:02x}", c)),
            };
            buf = (buf << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push(((buf >> bits) & 0xff) as u8);
            }
        }
        Ok(out)
    }
}

pub mod profile {
    //! Typed helper for `profile.get@1`.
    use super::{CallError, HostPipe};
    use crate::profile::Profile;

    /// Return the active profile override if the host provided one,
    /// or `None` if the host returned `{}` (use bundle default) or
    /// the capability wasn't registered.
    pub fn get(host: &dyn HostPipe) -> Result<Option<Profile>, CallError> {
        match host.call_capability("profile.get@1", "{}") {
            Ok(json) => {
                if json.trim() == "{}" {
                    Ok(None)
                } else {
                    serde_json::from_str::<Profile>(&json)
                        .map(Some)
                        .map_err(|e| CallError::Serde(e.to_string()))
                }
            }
            Err(CallError::NotProvided { .. }) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

pub mod runtime {
    //! Typed helpers for runtime context switching during local subruns.
    use alloc::string::String;
    use serde::Serialize;

    use super::{CallError, CapabilityName, HostPipe, call};
    use crate::profile::Profile;

    #[derive(Serialize)]
    pub struct PushContextRequest {
        pub run_id: Option<String>,
        pub profile: Option<Profile>,
    }

    #[derive(Serialize)]
    struct EmptyRequest {}

    pub fn push_context(
        host: &dyn HostPipe,
        run_id: Option<&str>,
        profile: Option<&Profile>,
    ) -> Result<(), CallError> {
        let _: serde_json::Value = call(
            host,
            CapabilityName::RuntimePushContext.as_str(),
            &PushContextRequest {
                run_id: run_id.map(|value| value.to_string()),
                profile: profile.cloned(),
            },
        )?;
        Ok(())
    }

    pub fn pop_context(host: &dyn HostPipe) -> Result<(), CallError> {
        let _: serde_json::Value = call(
            host,
            CapabilityName::RuntimePopContext.as_str(),
            &EmptyRequest {},
        )?;
        Ok(())
    }
}
