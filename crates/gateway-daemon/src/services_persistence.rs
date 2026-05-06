use snapdragon_gateway_core::{ServiceSpec, ServiceStatus};

use crate::GatewayDaemon;

pub(crate) struct ServiceLog<'a> {
    pub(crate) level: &'a str,
    pub(crate) message: &'a str,
}

impl GatewayDaemon {
    pub(crate) fn persist_service_status(
        &self,
        spec: Option<&ServiceSpec>,
        status: Option<&ServiceStatus>,
        at_ms: u64,
        log: Option<ServiceLog<'_>>,
    ) {
        let (Some(spec), Some(status), Some(store)) = (spec, status, self.store()) else {
            return;
        };
        let _ = store.persist_service(spec, status, at_ms);
        if let Some(log) = log {
            let _ = store.append_log(at_ms, log.level, Some(&spec.name), log.message, None);
        }
    }
}
