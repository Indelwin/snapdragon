import type {
  GatewayRestStreamErrorEvent,
  GatewayRestStreamEvent,
  GatewayRestStreamHeartbeatEvent,
  GatewayRestStreamSnapshotEvent,
  RestResponse,
} from './rest-types.js';
import type { GatewayOrchestrationClient } from './types-runtime.js';

type PendingStreamEvent =
  | Omit<GatewayRestStreamSnapshotEvent, 'id' | 'atMs'>
  | Omit<GatewayRestStreamHeartbeatEvent, 'id' | 'atMs'>
  | Omit<GatewayRestStreamErrorEvent, 'id' | 'atMs'>;

export interface GatewayRestStreamOptions {
  heartbeatMs: number;
  snapshotIntervalMs: number;
}

export async function sendStream(
  client: GatewayOrchestrationClient,
  response: RestResponse,
  options: GatewayRestStreamOptions,
): Promise<void> {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
    'x-accel-buffering': 'no',
  });
  let closed = false;
  let inFlight = false;
  let sequence = 0;
  const write = (event: PendingStreamEvent) => {
    if (closed || response.destroyed || response.writableEnded) return;
    sequence += 1;
    const envelope = { ...event, id: sequence, atMs: Date.now() } as GatewayRestStreamEvent;
    response.write(formatSse(envelope, options.snapshotIntervalMs));
  };
  const writeSnapshot = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      write({ type: 'snapshot', snapshot: await client.worldSnapshot() });
    } catch (error) {
      write({ type: 'error', error: errorMessage(error) });
    } finally {
      inFlight = false;
    }
  };
  await writeSnapshot();
  const snapshotTimer = setInterval(() => void writeSnapshot(), options.snapshotIntervalMs);
  const heartbeatTimer = setInterval(() => {
    write({ type: 'heartbeat', runtime: client.runtime });
  }, options.heartbeatMs);
  response.on('close', () => {
    closed = true;
    clearInterval(snapshotTimer);
    clearInterval(heartbeatTimer);
  });
}

function formatSse(event: GatewayRestStreamEvent, retryMs: number): string {
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `retry: ${retryMs}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
