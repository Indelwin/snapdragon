import type { GatewayRestStreamEvent } from './rest-types.js';

export async function* parseRestStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<GatewayRestStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, '\n');
      const result = yieldFrames(buffer);
      buffer = result.remaining;
      for (const event of result.events) yield event;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function yieldFrames(buffer: string): { events: GatewayRestStreamEvent[]; remaining: string } {
  const events: GatewayRestStreamEvent[] = [];
  let remaining = buffer;
  let boundary = remaining.indexOf('\n\n');
  while (boundary >= 0) {
    const event = parseFrame(remaining.slice(0, boundary));
    if (event) events.push(event);
    remaining = remaining.slice(boundary + 2);
    boundary = remaining.indexOf('\n\n');
  }
  return { events, remaining };
}

function parseFrame(frame: string): GatewayRestStreamEvent | undefined {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return undefined;
  return JSON.parse(data) as GatewayRestStreamEvent;
}
