import { assertRestOk } from './rest-client-response.js';
import { GatewaySseDecoder } from './rest-sse-decoder.js';
import type { GatewayWorldSnapshot } from './types-runtime.js';

export async function* readGatewaySnapshotStream(
  response: Response,
): AsyncIterable<GatewayWorldSnapshot> {
  await assertRestOk(response);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Gateway REST stream response has no body');
  const decoder = new TextDecoder();
  const events = new GatewaySseDecoder();
  let completed = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      for (const data of events.push(decoder.decode(chunk.value, { stream: true }))) {
        yield JSON.parse(data) as GatewayWorldSnapshot;
      }
    }
    for (const data of events.finish(decoder.decode())) {
      yield JSON.parse(data) as GatewayWorldSnapshot;
    }
    completed = true;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
