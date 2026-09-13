use std::{
    fs::{File, OpenOptions},
    io::{self, Write},
    os::fd::AsRawFd,
    path::{Path, PathBuf},
};

use tokio::net::UnixStream;

#[derive(Debug)]
pub(crate) struct SocketOwnership {
    socket: PathBuf,
    _file: File,
}

impl SocketOwnership {
    pub(crate) async fn acquire(socket: &Path) -> io::Result<Self> {
        let socket = socket.to_path_buf();
        let lock = PathBuf::from(format!("{}.lock", socket.display()));
        let file = lock_file(&lock)?;
        if UnixStream::connect(&socket).await.is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                format!("gateway socket is already live at {}", socket.display()),
            ));
        }
        if socket.exists() {
            std::fs::remove_file(&socket)?;
        }
        Ok(Self {
            socket,
            _file: file,
        })
    }

    pub(crate) fn socket_path(&self) -> &Path {
        &self.socket
    }
}

impl Drop for SocketOwnership {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket);
    }
}

fn lock_file(path: &Path) -> io::Result<File> {
    let token = format!("{}:{}", std::process::id(), unix_time_nanos());
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)?;
    try_lock(&file)?;
    file.set_len(0)?;
    file.write_all(token.as_bytes())?;
    file.sync_all()?;
    Ok(file)
}

#[cfg(unix)]
fn try_lock(file: &File) -> io::Result<()> {
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error() {
        Some(code) if code == libc::EWOULDBLOCK || code == libc::EAGAIN => Err(io::Error::new(
            io::ErrorKind::AddrInUse,
            "gateway ownership lock is held by another process",
        )),
        _ => Err(error),
    }
}

#[cfg(not(unix))]
fn try_lock(_file: &File) -> io::Result<()> {
    Ok(())
}

fn unix_time_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn advisory_lock_rejects_a_live_owner_and_recovers_stale_pid_text() {
        let socket = std::env::temp_dir().join(format!(
            "snapdragon-socket-lock-{}-{}",
            std::process::id(),
            unix_time_nanos()
        ));
        let lock = PathBuf::from(format!("{}.lock", socket.display()));
        std::fs::write(&lock, format!("{}:old-process", std::process::id())).unwrap();
        let owner = SocketOwnership::acquire(&socket).await.unwrap();
        assert_eq!(
            SocketOwnership::acquire(&socket).await.unwrap_err().kind(),
            io::ErrorKind::AddrInUse
        );
        drop(owner);
        let replacement = SocketOwnership::acquire(&socket).await.unwrap();
        drop(replacement);
        let _ = std::fs::remove_file(lock);
    }

    #[tokio::test]
    async fn failed_claim_never_unlinks_a_live_socket() {
        let socket = std::env::temp_dir().join(format!(
            "snapdragon-live-socket-{}-{}",
            std::process::id(),
            unix_time_nanos()
        ));
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        assert!(SocketOwnership::acquire(&socket).await.is_err());
        assert!(socket.exists());
        drop(listener);
        let _ = std::fs::remove_file(&socket);
        let _ = std::fs::remove_file(format!("{}.lock", socket.display()));
    }
}
