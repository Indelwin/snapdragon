use std::path::{Path, PathBuf};

use tokio::{
    fs::{self, File, OpenOptions},
    io::{AsyncReadExt, AsyncWriteExt},
};

use crate::{GatewayDaemon, process_tracking::WorkerStream};

pub(crate) const PREVIEW_BYTES: usize = 64 * 1024;
const COMPLETION_BYTES: usize = 256 * 1024;
const LOG_FILE_BYTES: u64 = 4 * 1024 * 1024;
const LOG_ROTATIONS: usize = 3;

pub(crate) struct PipeCapture {
    pub(crate) preview: Vec<u8>,
    pub(crate) completion: Vec<u8>,
}

pub(crate) fn spawn_pipe_reader<T>(
    daemon: GatewayDaemon,
    process_id: String,
    pipe: Option<T>,
    stream: WorkerStream,
    path: PathBuf,
    capture_completion: bool,
) -> tokio::task::JoinHandle<Result<PipeCapture, String>>
where
    T: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        drain_pipe(daemon, process_id, pipe, stream, path, capture_completion).await
    })
}

async fn drain_pipe<T>(
    daemon: GatewayDaemon,
    process_id: String,
    pipe: Option<T>,
    stream: WorkerStream,
    path: PathBuf,
    capture_completion: bool,
) -> Result<PipeCapture, String>
where
    T: tokio::io::AsyncRead + Unpin,
{
    let Some(mut pipe) = pipe else {
        return Ok(PipeCapture {
            preview: Vec::new(),
            completion: Vec::new(),
        });
    };
    let mut log = RotatingLog::open(path).await?;
    let mut preview = Vec::new();
    let mut completion = Vec::new();
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        let count = pipe
            .read(&mut chunk)
            .await
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        let bytes = &chunk[..count];
        log.write_all(bytes).await?;
        append_tail(&mut preview, bytes, PREVIEW_BYTES);
        if capture_completion && completion.len() < COMPLETION_BYTES {
            let remaining = COMPLETION_BYTES - completion.len();
            completion.extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        }
        daemon
            .update_worker_preview(
                &process_id,
                stream,
                String::from_utf8_lossy(&preview).into_owned(),
            )
            .await;
    }
    log.flush().await?;
    Ok(PipeCapture {
        preview,
        completion,
    })
}

fn append_tail(target: &mut Vec<u8>, bytes: &[u8], limit: usize) {
    if bytes.len() >= limit {
        target.clear();
        target.extend_from_slice(&bytes[bytes.len() - limit..]);
        return;
    }
    let overflow = target
        .len()
        .saturating_add(bytes.len())
        .saturating_sub(limit);
    if overflow > 0 {
        target.drain(..overflow);
    }
    target.extend_from_slice(bytes);
}

struct RotatingLog {
    path: PathBuf,
    file: Option<File>,
    len: u64,
}

impl RotatingLog {
    async fn open(path: PathBuf) -> Result<Self, String> {
        let len = fs::metadata(&path)
            .await
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let mut log = Self {
            path,
            file: None,
            len,
        };
        if log.len >= LOG_FILE_BYTES {
            log.rotate().await?;
        } else {
            log.open_file().await?;
        }
        Ok(log)
    }

    async fn write_all(&mut self, mut bytes: &[u8]) -> Result<(), String> {
        while !bytes.is_empty() {
            if self.len >= LOG_FILE_BYTES {
                self.rotate().await?;
            }
            let remaining = (LOG_FILE_BYTES - self.len) as usize;
            let count = bytes.len().min(remaining);
            self.file
                .as_mut()
                .expect("rotating log file is open")
                .write_all(&bytes[..count])
                .await
                .map_err(|error| error.to_string())?;
            self.len += count as u64;
            bytes = &bytes[count..];
        }
        Ok(())
    }

    async fn flush(&mut self) -> Result<(), String> {
        self.file
            .as_mut()
            .expect("rotating log file is open")
            .flush()
            .await
            .map_err(|error| error.to_string())
    }

    async fn rotate(&mut self) -> Result<(), String> {
        self.file.take();
        let _ = fs::remove_file(rotated_path(&self.path, LOG_ROTATIONS)).await;
        for index in (1..LOG_ROTATIONS).rev() {
            let _ = fs::rename(
                rotated_path(&self.path, index),
                rotated_path(&self.path, index + 1),
            )
            .await;
        }
        if fs::metadata(&self.path).await.is_ok() {
            fs::rename(&self.path, rotated_path(&self.path, 1))
                .await
                .map_err(|error| error.to_string())?;
        }
        self.len = 0;
        self.open_file().await
    }

    async fn open_file(&mut self) -> Result<(), String> {
        self.file = Some(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .await
                .map_err(|error| error.to_string())?,
        );
        Ok(())
    }
}

fn rotated_path(path: &Path, index: usize) -> PathBuf {
    PathBuf::from(format!("{}.{}", path.display(), index))
}
