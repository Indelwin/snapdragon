import { worldSnapshotOptionsFromSearch } from './rest-query.js';
import type { RestResponse } from './rest-types.js';
import type { GatewayOrchestrationClient } from './types-runtime.js';

export async function sendStream(
  client: GatewayOrchestrationClient,
  response: RestResponse,
  intervalMs: number,
  searchParams = new URLSearchParams(),
): Promise<void> {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  const options = worldSnapshotOptionsFromSearch(searchParams);
  await writeSnapshot(client, response, options).catch((error) =>
    writeStreamError(response, error),
  );
  const interval = setInterval(() => {
    writeSnapshot(client, response, options).catch((error) => writeStreamError(response, error));
  }, intervalMs);
  response.on('close', () => clearInterval(interval));
}

async function writeSnapshot(
  client: GatewayOrchestrationClient,
  response: RestResponse,
  options: Parameters<GatewayOrchestrationClient['worldSnapshot']>[0],
): Promise<void> {
  const snapshot = await client.worldSnapshot(options);
  response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
}

function writeStreamError(response: RestResponse, error: unknown): void {
  response.write(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`);
}
