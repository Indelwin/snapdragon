import { assertRestOk } from './rest-client-response.js';
import type { GatewayWorldSnapshot } from './types-runtime.js';

export async function* readGatewaySnapshotStream(
  response: Response,
): AsyncIterable<GatewayWorldSnapshot> {
  await assertRestOk(response);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Gateway REST stream response has no body');
  const decoder = new TextDecoder();
  const events = new GatewaySseDecoder();
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
  } finally {
    reader.releaseLock();
  }
}

class GatewaySseDecoder {
  #buffer = '';

  push(chunk: string): string[] {
    this.#buffer += chunk;
    return this.#drain();
  }

  finish(chunk = ''): string[] {
    this.#buffer += chunk;
    const messages = this.#drain();
    const tail = messageData(this.#buffer);
    this.#buffer = '';
    return tail ? [...messages, tail] : messages;
  }

  #drain(): string[] {
    const messages: string[] = [];
    let index = this.#buffer.indexOf('\n\n');
    while (index >= 0) {
      const raw = this.#buffer.slice(0, index);
      this.#buffer = this.#buffer.slice(index + 2);
      const data = messageData(raw);
      if (data) messages.push(data);
      index = this.#buffer.indexOf('\n\n');
    }
    return messages;
  }
}

function messageData(raw: string): string | undefined {
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? data.join('\n') : undefined;
}
