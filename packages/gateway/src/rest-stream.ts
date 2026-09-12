import { worldSnapshotOptionsFromSearch } from './rest-query.js';
import { MAX_GATEWAY_HTTP_RESPONSE_BYTES, type RestResponse } from './rest-types.js';
import type { GatewayOrchestrationClient } from './types-runtime.js';

export async function sendStream(
  client: GatewayOrchestrationClient,
  response: RestResponse,
  intervalMs: number,
  searchParams = new URLSearchParams(),
): Promise<void> {
  let closed = false;
  let started = false;
  const abort = new AbortController();
  const onClose = () => {
    closed = true;
    abort.abort();
  };
  response.once('close', onClose);
  try {
    response.writeHead(200, {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
    });
    started = true;
    const options = worldSnapshotOptionsFromSearch(searchParams);
    while (!closed) {
      try {
        const snapshot = await client.worldSnapshot(options);
        if (closed || !(await writeEvent(response, 'snapshot', snapshot))) return;
      } catch (error) {
        if (closed || !(await writeEvent(response, 'error', { error: String(error) }))) return;
      }
      if (!(await waitForNext(intervalMs, abort.signal))) return;
    }
  } finally {
    response.off('close', onClose);
    if (started && !closed) response.end();
  }
}

async function writeEvent(response: RestResponse, event: string, data: unknown): Promise<boolean> {
  let payload = JSON.stringify(data);
  if (Buffer.byteLength(payload) > MAX_GATEWAY_HTTP_RESPONSE_BYTES) {
    payload = JSON.stringify({
      error: `SSE event exceeds ${MAX_GATEWAY_HTTP_RESPONSE_BYTES} bytes; request fewer sections`,
    });
    event = 'error';
  }
  if (response.write(`event: ${event}\ndata: ${payload}\n\n`)) return true;
  return waitForDrain(response);
}

function waitForDrain(response: RestResponse): Promise<boolean> {
  return new Promise((resolve) => {
    const cleanup = () => {
      response.off('drain', onDrain);
      response.off('close', onClose);
      response.off('error', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve(true);
    };
    const onClose = () => {
      cleanup();
      resolve(false);
    };
    response.once('drain', onDrain);
    response.once('close', onClose);
    response.once('error', onClose);
  });
}

function waitForNext(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(true), milliseconds);
    const onAbort = () => settle(false);
    const settle = (next: boolean) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(next);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
