import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { InlineGatewayClient, RustGatewayClient } from '../src/index.js';

test('inline gateway supports selective receive without reordering other messages', async () => {
  const gateway = new InlineGatewayClient();
  const target = { id: 'agent' };
  await gateway.send({
    id: 1,
    kind: 'event.publish',
    target,
    payload: {},
    insertedAtMs: 1,
  });
  await gateway.send({
    id: 2,
    kind: 'capability.call',
    target,
    capability: 'memory.read',
    payload: {},
    insertedAtMs: 2,
  });
  const selected = await gateway.receive(target, { capability: 'memory.read' });
  assert.equal(selected?.id, 2);
  const remaining = await gateway.receive(target);
  assert.equal(remaining?.id, 1);
});

test('inline gateway tracks service runs and errors', async () => {
  const gateway = new InlineGatewayClient();
  await gateway.registerService(
    { name: 'ok' },
    {
      async run() {
        return { summary: 'done' };
      },
    },
  );
  await gateway.registerService(
    { name: 'bad' },
    {
      async run() {
        throw new Error('boom');
      },
    },
  );
  assert.equal((await gateway.runService('ok'))?.runs, 1);
  const bad = await gateway.runService('bad');
  assert.equal(bad?.errors, 1);
  assert.equal(bad?.lastError, 'boom');
});

test('rust gateway client speaks the JSONL IPC protocol', async () => {
  const socketPath = join(tmpdir(), `snapdragon-gateway-${process.pid}-${Date.now()}.sock`);
  const seen: string[] = [];
  const requests: any[] = [];
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) return;
      const request = JSON.parse(buffer.slice(0, lineEnd));
      seen.push(request.method);
      requests.push(request);
      socket.end(`${JSON.stringify(responseFor(request))}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    const gateway = new RustGatewayClient({ socketPath });
    await gateway.registerService({
      name: 'memory-worker',
      worker: { command: 'node', args: ['worker.js'], cwd: '/tmp/sd', env: { A: 'B' } },
    });
    await gateway.send({
      id: 7,
      kind: 'event.publish',
      target: { id: 'worker' },
      payload: { ok: true },
      insertedAtMs: 10,
    });
    assert.equal((await gateway.status()).services[0]?.state, 'running');
    assert.equal((await gateway.receive({ id: 'worker' }))?.target.id, 'worker');
    assert.deepEqual(await gateway.whereisCapability('memory.read'), [{ id: 'worker' }]);
    assert.deepEqual(await gateway.registrySnapshot(), {
      names: {},
      capabilities: { 'memory.read': [{ id: 'worker' }] },
      channels: {},
    });
    assert.equal(await gateway.createTable('state', { id: 'worker' }, 'private'), true);
    assert.deepEqual(await gateway.tableNames(), ['state']);
    assert.deepEqual(await gateway.tableSnapshot('state'), {
      name: 'state',
      owner: { id: 'worker' },
      access: 'private',
      rows: 0,
    });
    assert.deepEqual(requests[0].params.spec.worker, {
      command: 'node',
      args: ['worker.js'],
      cwd: '/tmp/sd',
      env: { A: 'B' },
    });
    assert.deepEqual(seen, [
      'services.register',
      'envelope.send',
      'status',
      'envelope.receive',
      'registry.whereis_capability',
      'registry.list',
      'tables.create',
      'tables.list',
      'tables.show',
    ]);
  } finally {
    server.close();
    await rm(socketPath, { force: true });
  }
});

test('rust gateway client records local runner runs without invoking daemon workers', async () => {
  const socketPath = join(tmpdir(), `snapdragon-gateway-local-${process.pid}-${Date.now()}.sock`);
  const seen: string[] = [];
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) return;
      const request = JSON.parse(buffer.slice(0, lineEnd));
      seen.push(request.method);
      socket.end(`${JSON.stringify(responseFor(request))}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    const gateway = new RustGatewayClient({ socketPath });
    await gateway.registerService(
      { name: 'local' },
      {
        async run() {
          return { summary: 'local ok' };
        },
      },
    );
    const status = await gateway.runService('local');
    assert.equal(status?.runs, 1);
    assert.deepEqual(seen, ['services.register', 'services.record_run']);
  } finally {
    server.close();
    await rm(socketPath, { force: true });
  }
});

function responseFor(request: any): unknown {
  if (request.method === 'status') {
    return {
      id: request.id,
      ok: true,
      result: {
        services: [wireServiceStatus('memory-worker')],
        processes: 1,
        tables: [],
      },
    };
  }
  if (request.method === 'envelope.receive') {
    return {
      id: request.id,
      ok: true,
      result: {
        id: 7,
        kind: 'event.publish',
        target: request.params.actor,
        payload: {},
        inserted_at_ms: 10,
      },
    };
  }
  if (request.method === 'registry.whereis_capability') {
    return { id: request.id, ok: true, result: ['worker'] };
  }
  if (request.method === 'registry.list') {
    return {
      id: request.id,
      ok: true,
      result: { names: {}, capabilities: { 'memory.read': ['worker'] }, channels: {} },
    };
  }
  if (request.method === 'tables.list') return { id: request.id, ok: true, result: ['state'] };
  if (request.method === 'tables.show') {
    return {
      id: request.id,
      ok: true,
      result: { name: request.params.name, owner: 'worker', access: 'Private', rows: 0 },
    };
  }
  if (request.method === 'services.record_run') {
    return {
      id: request.id,
      ok: true,
      result: {
        ...wireServiceStatus(request.params.name),
        runs: 1,
        last_summary: request.params.summary,
      },
    };
  }
  return { id: request.id, ok: true, result: true };
}

function wireServiceStatus(name: string): unknown {
  return {
    name,
    enabled: true,
    state: 'Running',
    runs: 0,
    errors: 0,
    last_run_at_ms: null,
    last_error: null,
    last_summary: null,
  };
}
