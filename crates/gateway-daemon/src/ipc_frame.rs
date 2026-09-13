use std::io;

use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub(crate) enum Frame {
    End,
    Data(Vec<u8>),
    Oversized,
}

pub(crate) async fn read_frame<R>(reader: &mut R, max_bytes: usize) -> io::Result<Frame>
where
    R: AsyncBufRead + Unpin,
{
    let mut frame = Vec::new();
    let mut oversized = false;
    let mut saw_bytes = false;
    loop {
        let buffer = reader.fill_buf().await?;
        if buffer.is_empty() {
            return if !saw_bytes {
                Ok(Frame::End)
            } else if oversized {
                Ok(Frame::Oversized)
            } else {
                Ok(Frame::Data(frame))
            };
        }
        saw_bytes = true;
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let count = newline.unwrap_or(buffer.len());
        if !oversized {
            if frame.len().saturating_add(count) > max_bytes {
                oversized = true;
                frame.clear();
            } else {
                frame.extend_from_slice(&buffer[..count]);
            }
        }
        reader.consume(count + usize::from(newline.is_some()));
        if newline.is_some() {
            if frame.last() == Some(&b'\r') {
                frame.pop();
            }
            return if oversized {
                Ok(Frame::Oversized)
            } else {
                Ok(Frame::Data(frame))
            };
        }
    }
}
