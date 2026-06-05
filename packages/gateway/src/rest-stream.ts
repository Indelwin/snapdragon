import type { RestResponse } from './rest-types.js';
import type { GatewayOrchestrationClient } from './types-runtime.js';

export async function sendStream(
  client: GatewayOrchestrationClient,
  response: RestResponse,
  intervalMs: number,
): Promise<void> {
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  await writeSnapshot(client, response).catch((error) => writeStreamError(response, error));
  const interval = setInterval(() => {
    writeSnapshot(client, response).catch((error) => writeStreamError(response, error));
  }, intervalMs);
  response.on('close', () => clearInterval(interval));
}

async function writeSnapshot(
  client: GatewayOrchestrationClient,
  response: RestResponse,
): Promise<void> {
  const snapshot = await client.worldSnapshot();
  response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
}

function writeStreamError(response: RestResponse, error: unknown): void {
  response.write(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`);
}
