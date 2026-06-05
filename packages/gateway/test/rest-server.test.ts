import assert from 'node:assert/strict';
import test from 'node:test';
import { createGatewayRestServer, InlineGatewayClient } from '../src/index.js';

test('REST server treats the path prefix as a full segment', async () => {
  const gateway = new InlineGatewayClient();
  const rest = createGatewayRestServer(gateway);
  const baseUrl = await rest.listen();
  try {
    const stray = await fetch(baseUrl.replace('/v1', '/v10/health'));
    assert.equal(stray.status, 404);
    assert.deepEqual(await stray.json(), { error: 'not found' });

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).runtime, 'inline-ts');
  } finally {
    await rest.close();
  }
});

test('REST server reports malformed JSON as a bad request', async () => {
  const gateway = new InlineGatewayClient();
  const rest = createGatewayRestServer(gateway);
  const baseUrl = await rest.listen();
  try {
    const response = await fetch(`${baseUrl}/services`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid JSON' });
  } finally {
    await rest.close();
  }
});

test('REST stream emits world snapshots as server-sent events', async () => {
  const gateway = new InlineGatewayClient();
  await gateway.registerAgentRuntime({ id: 'sd', kind: 'sd', protocol: 'embedded' });
  const rest = createGatewayRestServer(gateway, { streamIntervalMs: 5_000 });
  const baseUrl = await rest.listen();
  const controller = new AbortController();
  try {
    const response = await fetch(`${baseUrl}/stream`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');

    const event = await readFirstSseEvent(response);
    assert.equal(event.name, 'snapshot');
    assert.equal(event.data.runtime, 'inline-ts');
    assert.equal(event.data.agentRuntimes[0]?.id, 'sd');
  } finally {
    controller.abort();
    await rest.close();
  }
});

async function readFirstSseEvent(response: Response): Promise<{ name: string; data: any }> {
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    const boundary = text.indexOf('\n\n');
    if (boundary >= 0) return parseSseEvent(text.slice(0, boundary));
  }
  throw new Error('SSE stream ended before first event');
}

function parseSseEvent(raw: string): { name: string; data: any } {
  const lines = raw.split('\n');
  const name = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length);
  const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length);
  assert.ok(name);
  assert.ok(data);
  return { name, data: JSON.parse(data) };
}
