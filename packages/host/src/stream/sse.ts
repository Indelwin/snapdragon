export async function* sseLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };

  try {
    signal?.throwIfAborted();
    signal?.addEventListener('abort', abort, { once: true });

    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        complete = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = parseFrame(frame);
        if (data !== undefined) yield data;
        boundary = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode();
    const data = parseFrame(buffer);
    if (data !== undefined) yield data;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!complete) await reader.cancel(signal?.reason).catch(() => undefined);
    reader.releaseLock();
  }
}

function parseFrame(frame: string): string | undefined {
  const lines = frame.split(/\r?\n/);
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  return data.join('\n');
}
