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

    pub(crate) async fn shutdown(&mut self) -> Result<(), String> {
        self.terminate(false);
        if wait_for_process_group_exit(self.pid, TERMINATION_GRACE).await {
            self.disarm();
            return Ok(());
        }

        self.terminate(true);
        if wait_for_process_group_exit(self.pid, TERMINATION_GRACE).await {
            self.disarm();
            return Ok(());
        }

        Err("worker process group remained live after SIGKILL".into())
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

#[cfg(unix)]
fn process_group_is_alive(pid: Option<u32>) -> bool {
    let Some(pid) = pid.and_then(|pid| i32::try_from(pid).ok()) else {
        return false;
    };
    if unsafe { libc::kill(-pid, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH)
}

#[cfg(not(unix))]
fn process_group_is_alive(_pid: Option<u32>) -> bool {
    false
}

async fn wait_for_process_group_exit(pid: Option<u32>, grace: Duration) -> bool {
    if !process_group_is_alive(pid) {
        return true;
    }
    tokio::time::timeout(grace, async {
        loop {
            tokio::time::sleep(Duration::from_millis(10)).await;
            if !process_group_is_alive(pid) {
                return;
            }
        }
    })
    .await
    .is_ok()
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
    TERMINATION_GRACE.saturating_mul(2) + Duration::from_millis(250)
}
