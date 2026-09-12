use std::path::PathBuf;

use crate::GatewayDaemon;

pub(crate) struct WorkerOutputPaths {
    pub(crate) root: PathBuf,
    pub(crate) stdout: PathBuf,
    pub(crate) stderr: PathBuf,
    pub(crate) completion: PathBuf,
}

pub(crate) fn worker_output_paths(daemon: &GatewayDaemon, service: &str) -> WorkerOutputPaths {
    let root = daemon.store().map_or_else(
        || std::env::temp_dir().join("snapdragon-gateway-worker-logs"),
        |store| store.worker_log_dir(),
    );
    let service = safe_file_component(service);
    let nonce = unix_time_nanos();
    WorkerOutputPaths {
        stdout: root.join(format!("{service}.stdout.log")),
        stderr: root.join(format!("{service}.stderr.log")),
        completion: root.join(format!(".{service}.{nonce}.completion.json")),
        root,
    }
}

fn safe_file_component(value: &str) -> String {
    let value = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if value.is_empty() {
        "service".into()
    } else {
        value
    }
}

fn unix_time_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
