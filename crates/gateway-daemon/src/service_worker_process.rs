use std::{path::Path, time::Duration};

use snapdragon_gateway_core::ServiceWorkerSpec;
use tokio::process::{Child, Command};

use crate::ServiceRunControl;

const TERMINATION_GRACE: Duration = Duration::from_secs(1);

#[derive(Clone, Copy)]
pub(crate) enum WaitReason {
    Exited,
    TimedOut,
    Cancelled,
}

pub(crate) fn worker_command(worker: &ServiceWorkerSpec, completion: &Path) -> Command {
    let mut command = Command::new(&worker.command);
    command.args(&worker.args);
    command.kill_on_drop(true);
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    command.env("SNAPDRAGON_GATEWAY_COMPLETION_PATH", completion);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    if let Some(cwd) = &worker.cwd {
        command.current_dir(cwd);
    }
    for (key, value) in &worker.env {
        command.env(key, value);
    }
    command
}

pub(crate) async fn wait_for_child(
    child: &mut Child,
    timeout_ms: Option<u64>,
    control: &ServiceRunControl,
) -> Result<(std::process::ExitStatus, WaitReason), String> {
    tokio::select! {
        result = child.wait() => result
            .map(|status| (status, WaitReason::Exited))
            .map_err(|error| error.to_string()),
        _ = wait_for_timeout(timeout_ms) => {
            terminate_child(child).await.map(|status| (status, WaitReason::TimedOut))
        },
        _ = control.cancelled() => {
            terminate_child(child).await.map(|status| (status, WaitReason::Cancelled))
        },
    }
}

async fn wait_for_timeout(timeout_ms: Option<u64>) {
    match timeout_ms.filter(|milliseconds| *milliseconds > 0) {
        Some(milliseconds) => tokio::time::sleep(Duration::from_millis(milliseconds)).await,
        None => std::future::pending().await,
    }
}

async fn terminate_child(child: &mut Child) -> Result<std::process::ExitStatus, String> {
    terminate_process_group(child.id(), false);
    match tokio::time::timeout(TERMINATION_GRACE, child.wait()).await {
        Ok(result) => result.map_err(|error| error.to_string()),
        Err(_) => {
            terminate_process_group(child.id(), true);
            let _ = child.start_kill();
            child.wait().await.map_err(|error| error.to_string())
        }
    }
}

pub(crate) struct ProcessGroupGuard {
    pid: Option<u32>,
}

impl ProcessGroupGuard {
    pub(crate) fn new(pid: Option<u32>) -> Self {
        Self { pid }
    }

    pub(crate) fn disarm(&mut self) {
        self.pid = None;
    }

    pub(crate) fn terminate(&self, force: bool) {
        terminate_process_group(self.pid, force);
    }
}

impl Drop for ProcessGroupGuard {
    fn drop(&mut self) {
        terminate_process_group(self.pid, true);
    }
}

#[cfg(unix)]
fn terminate_process_group(pid: Option<u32>, force: bool) {
    let Some(pid) = pid else {
        return;
    };
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

#[cfg(not(unix))]
fn terminate_process_group(_pid: Option<u32>, _force: bool) {}

#[cfg(unix)]
pub(crate) fn exit_signal(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(|signal| signal.to_string())
}

#[cfg(not(unix))]
pub(crate) fn exit_signal(_status: &std::process::ExitStatus) -> Option<String> {
    None
}

pub(crate) fn drain_grace() -> Duration {
    TERMINATION_GRACE
}
