import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createGatewayRestServer,
  GatewayRestClient,
  InlineGatewayClient,
  RustGatewayClient,
  runPiRpcAgentJob,
} from '../src/index.js';
import { readGatewaySnapshotStream } from '../src/rest-client-sse.js';
import { sendStream } from '../src/rest-stream.js';

test('inline leases use immutable snapshots and reject stale attempts', async () => {
  const gateway = new InlineGatewayClient();
  const payload = { nested: { value: 1 } };
  const job = await gateway.enqueueJob({ kind: 'agent.run', payload, maxAttempts: 2 }, 'job');
  (job.spec.payload as typeof payload).nested.value = 99;
  assert.equal(((await gateway.showJob('job'))?.spec.payload as typeof payload).nested.value, 1);

  const first = await gateway.acquireJob('default', 'worker', 15);
  assert.ok(first);
  first.job.state = 'completed';
  first.lease.expiresAtMs = Number.MAX_SAFE_INTEGER;
  assert.equal((await gateway.showJob('job'))?.state, 'running');
  await delay(25);
  assert.equal((await gateway.showJob('job'))?.state, 'pending');

  const second = await gateway.acquireJob('default', 'worker', 5_000);
  assert.ok(second);
  const stale = { leaseId: first.lease.id, attempt: first.lease.attempt };
  await assert.rejects(gateway.renewJob('job', stale), /stale lease fence/);
  await assert.rejects(gateway.completeJob('job', {}, stale), /stale lease fence/);
  await assert.rejects(gateway.failJob('job', 'late', stale), /stale lease fence/);
  const renewed = await gateway.renewJob(
    'job',
    { leaseId: second.lease.id, attempt: second.lease.attempt },
    10_000,
  );
  assert.equal(renewed?.lease.attempt, 2);
  await gateway.close();
});

test('inline jobs reject duplicate ids and one worker cannot hold two leases', async () => {
  const gateway = new InlineGatewayClient();
  await gateway.enqueueJob({ kind: 'first' }, 'duplicate');
  await assert.rejects(gateway.enqueueJob({ kind: 'replacement' }, 'duplicate'), /already exists/);
  await gateway.enqueueJob({ kind: 'second' }, 'second');
  const first = await gateway.acquireJob('default', 'single-worker', 10_000);
  assert.ok(first);
  await assert.rejects(gateway.acquireJob('default', 'single-worker'), /is busy/);
  assert.equal((await gateway.showJob('second'))?.state, 'pending');
  await gateway.registerWorker({ id: 'single-worker', status: 'registered again' });
  await gateway.heartbeatWorker({
    id: 'single-worker',
    state: 'idle',
    status: 'not actually idle',
  });
  const before = await gateway.showWorker('single-worker');
  assert.ok(before);
  assert.equal(before.state, 'running');
  assert.equal(before.currentJobId, first.job.id);
  const previousExpiry = before.leaseExpiresAtMs;
  assert.ok(previousExpiry);
  before.state = 'offline';
  assert.equal((await gateway.showWorker('single-worker'))?.state, 'running');
  const renewed = await gateway.renewJob(
    first.job.id,
    { leaseId: first.lease.id, attempt: first.lease.attempt },
    20_000,
  );
  assert.ok(renewed);
  const workerAfterRenew = await gateway.showWorker('single-worker');
  assert.ok(workerAfterRenew?.leaseExpiresAtMs);
  assert.ok(workerAfterRenew.leaseExpiresAtMs > previousExpiry);
  await gateway.completeJob(
    first.job.id,
    {},
    {
      leaseId: first.lease.id,
      attempt: first.lease.attempt,
    },
  );
  assert.equal((await gateway.acquireJob('default', 'single-worker'))?.job.id, 'second');
  await gateway.close();
});

test('inline close clears owned expiry timers and clamps long delays', async () => {
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const delays: number[] = [];
  const cleared: unknown[] = [];
  const fakeTimer = { unref() {} };
  (globalThis as any).setTimeout = (_callback: () => void, milliseconds: number) => {
    delays.push(milliseconds);
    return fakeTimer;
  };
  (globalThis as any).clearTimeout = (timer: unknown) => cleared.push(timer);
  try {
    const gateway = new InlineGatewayClient();
    await gateway.enqueueJob({ kind: 'agent.run' }, 'long-job');
    await gateway.acquireJob('default', 'worker', Number.MAX_SAFE_INTEGER);
    assert.equal(delays[0], 2_147_483_647);
    await gateway.close();
    assert.deepEqual(cleared, [fakeTimer]);
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
  }

  const gateway = new InlineGatewayClient();
  await gateway.enqueueJob({ kind: 'agent.run', maxAttempts: 2 }, 'closed-job');
  await gateway.acquireJob('default', 'worker', 10);
  await gateway.close();
  await delay(20);
  assert.equal((await gateway.showJob('closed-job'))?.state, 'running');
});

test('inline services serialize runs and disable waits for cancellation', async () => {
  const gateway = new InlineGatewayClient();
  let active = 0;
  let maxActive = 0;
  await gateway.registerService(
    { name: 'serial' },
    {
      async run(signal) {
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          await abortableDelay(20, signal);
          return { summary: 'done' };
        } finally {
          active--;
        }
      },
    },
  );
  await Promise.all([gateway.runService('serial'), gateway.runService('serial')]);
  assert.equal(maxActive, 1);
  assert.equal((await gateway.listServices())[0]?.runs, 2);

  let cancelled = false;
  await gateway.registerService(
    { name: 'cancel' },
    {
      async run(signal) {
        try {
          await abortableDelay(60_000, signal);
        } catch (error) {
          cancelled = true;
          throw error;
        }
      },
    },
  );
  const running = gateway.runService('cancel');
  await delay(5);
  await gateway.enableService('cancel', false);
  await running;
  assert.equal(cancelled, true);
  assert.equal(
    (await gateway.listServices()).find(({ name }) => name === 'cancel')?.state,
    'stopped',
  );

  let firstReplacementRuns = 0;
  let secondReplacementRuns = 0;
  const firstReplacement = gateway.registerService(
    { name: 'replace' },
    {
      async run() {
        firstReplacementRuns++;
      },
    },
  );
  const secondReplacement = gateway.registerService(
    { name: 'replace' },
    {
      async run() {
        secondReplacementRuns++;
      },
    },
  );
  await Promise.all([firstReplacement, secondReplacement]);
  await gateway.runService('replace');
  assert.equal(firstReplacementRuns, 0);
  assert.equal(secondReplacementRuns, 1);
  await gateway.close();
});

test('inline mailbox rejects oversized and busy sends without dropping queued messages', async () => {
  const gateway = new InlineGatewayClient();
  const target = { id: 'mailbox' };
  await assert.rejects(
    gateway.send(envelope(0, target, 'x'.repeat(1024 * 1024))),
    /mailbox message oversized/,
  );
  for (let index = 0; index < 1_024; index++) {
    await gateway.send(envelope(index, target, 'ok'));
  }
  await assert.rejects(gateway.send(envelope(1_025, target, 'busy')), /mailbox busy/);
  assert.equal((await gateway.receive(target))?.id, 0);

  const byteGateway = new InlineGatewayClient();
  const bytesTarget = { id: 'bytes' };
  for (let index = 0; index < 9; index++) {
    await byteGateway.send(envelope(index, bytesTarget, 'x'.repeat(900_000)));
  }
  await assert.rejects(
    byteGateway.send(envelope(10, bytesTarget, 'x'.repeat(900_000))),
    /mailbox busy/,
  );
  assert.equal((await byteGateway.receive(bytesTarget))?.id, 0);
});

test('REST bounds bodies and responses and clients drain paged lists', async () => {
  const gateway = new InlineGatewayClient();
  for (let index = 0; index < 205; index++) {
    await gateway.enqueueJob({ kind: 'page', payload: { index } }, `job-${index}`);
  }
  const rest = createGatewayRestServer(gateway);
  const baseUrl = await rest.listen();
  try {
    const firstPage = await fetch(`${baseUrl}/jobs?limit=100`);
    assert.equal(firstPage.status, 200);
    const page = (await firstPage.json()) as { items: unknown[]; nextCursor?: string };
    assert.equal(page.items.length, 100);
    assert.ok(page.nextCursor);
    const client = new GatewayRestClient({ baseUrl });
    assert.equal((await client.listJobs({ jobKind: 'page' })).length, 205);

    const oversized = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'large', payload: 'x'.repeat(1024 * 1024) }),
    });
    assert.equal(oversized.status, 413);
    assert.match(await oversized.text(), /request body exceeds/);
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);

    await gateway.enqueueJob({ kind: 'large', payload: 'x'.repeat(1024 * 1024) }, 'large');
    const response = await fetch(`${baseUrl}/world?sections=jobs`);
    assert.equal(response.status, 507);
    assert.match(await response.text(), /response body exceeds/);
  } finally {
    await rest.close();
    await gateway.close();
  }
});

test('SSE reads cancel on early exit and server writes are single-flight and drain-aware', async () => {
  let readerCancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode('event: snapshot\ndata: {"runtime":"inline-ts"}\n\n'),
      );
    },
    cancel() {
      readerCancelled = true;
    },
  });
  const iterator = readGatewaySnapshotStream(new Response(body))[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value?.runtime, 'inline-ts');
  await iterator.return?.();
  assert.equal(readerCancelled, true);

  let calls = 0;
  const response = new FakeStreamResponse();
  const streaming = sendStream(
    {
      async worldSnapshot() {
        calls++;
        return { runtime: 'inline-ts', calls };
      },
    } as any,
    response as any,
    0,
  );
  await delay(10);
  assert.equal(calls, 1);
  assert.equal(response.writes, 1);
  response.emit('drain');
  await delay(10);
  assert.ok(calls >= 2);
  assert.equal(response.maxWrites, 1);
  response.emit('close');
  await streaming;

  const coalesced = Array.from(
    { length: 24_000 },
    (_, index) => `data: {"runtime":"inline-ts","index":${index}}\r\n\r\n`,
  ).join('');
  assert.ok(Buffer.byteLength(coalesced) > 1024 * 1024);
  const coalescedBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(coalesced));
      controller.close();
    },
  });
  let snapshots = 0;
  for await (const _snapshot of readGatewaySnapshotStream(new Response(coalescedBody))) snapshots++;
  assert.equal(snapshots, 24_000);

  const setupFailure = new EventEmitter() as EventEmitter & {
    writeHead(): void;
    end(): void;
  };
  setupFailure.writeHead = () => {
    throw new Error('write setup failed');
  };
  setupFailure.end = () => undefined;
  await assert.rejects(sendStream({} as any, setupFailure as any, 0), /write setup failed/);
  assert.equal(setupFailure.listenerCount('close'), 0);
});

test('Rust IPC rejects malformed, closed, mismatched, and oversized exchanges', async () => {
  await withIpcServer(
    (socket) => socket.end('{not-json}\n'),
    async (socketPath) => {
      await assert.rejects(new RustGatewayClient({ socketPath }).status(), /Malformed gateway IPC/);
    },
  );
  await withIpcServer(
    (socket) => socket.end(),
    async (socketPath) => {
      await assert.rejects(
        new RustGatewayClient({ socketPath }).status(),
        /closed before a response/,
      );
    },
  );
  await withIpcServer(
    (socket) => socket.end('{"id":999,"ok":true,"result":{}}\n'),
    async (socketPath) => {
      await assert.rejects(new RustGatewayClient({ socketPath }).status(), /did not match request/);
    },
  );
  const missingSocket = join(tmpdir(), `snapdragon-missing-${process.pid}-${Date.now()}.sock`);
  await assert.rejects(
    new RustGatewayClient({ socketPath: missingSocket }).enqueueJob({
      kind: 'large',
      payload: 'x'.repeat(1024 * 1024),
    }),
    /request exceeds/,
  );

  let resolveLateWrite!: (failed: boolean) => void;
  const lateWriteFailed = new Promise<boolean>((resolve) => {
    resolveLateWrite = resolve;
  });
  await withIpcServer(
    (socket) => {
      let settled = false;
      const finish = (failed: boolean) => {
        if (settled) return;
        settled = true;
        resolveLateWrite(failed);
        socket.destroy();
      };
      socket.once('error', () => finish(true));
      socket.write('{"id":1,"ok":true,"result":{}}\n');
      setTimeout(() => socket.write('late response bytes', (error) => finish(Boolean(error))), 25);
    },
    async (socketPath) => {
      assert.equal((await new RustGatewayClient({ socketPath }).status()).runtime, 'rust');
    },
    { allowHalfOpen: true },
  );
  assert.equal(await lateWriteFailed, true);
});

test('Pi keeps a bounded result trace while the observer receives the full flood', async () => {
  const fixture = await writePiFloodFixture();
  let observed = 0;
  let active = 0;
  let maxActive = 0;
  try {
    const result = await runPiRpcAgentJob(
      { prompt: 'flood', targetRuntimeId: 'pi' },
      {
        command: process.execPath,
        args: [fixture.path],
        timeoutMs: 5_000,
        async onEvent() {
          observed++;
          active++;
          maxActive = Math.max(maxActive, active);
          await delay(1);
          active--;
        },
      },
    );
    assert.equal(observed, 702);
    assert.equal(result.metrics.event_count, 702);
    assert.equal(result.events.length, 512);
    assert.equal(result.metrics.dropped_event_count, 190);
    assert.ok(maxActive <= 16);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

class FakeStreamResponse extends EventEmitter {
  writes = 0;
  maxWrites = 0;
  #blocked = false;

  writeHead() {}

  write(): boolean {
    this.writes++;
    assert.equal(this.#blocked, false, 'wrote another SSE frame before drain');
    this.#blocked = true;
    this.maxWrites = Math.max(this.maxWrites, 1);
    return false;
  }

  end() {}

  override emit(event: string | symbol, ...args: any[]): boolean {
    if (event === 'drain') this.#blocked = false;
    return super.emit(event, ...args);
  }
}

function envelope(id: number, target: { id: string }, payload: unknown) {
  return { id, kind: 'test', target, payload, insertedAtMs: id };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function withIpcServer(
  respond: (socket: import('node:net').Socket) => void,
  run: (socketPath: string) => Promise<void>,
  options: { allowHalfOpen?: boolean } = {},
): Promise<void> {
  const socketPath = join(
    tmpdir(),
    `snapdragon-ipc-${process.pid}-${Date.now()}-${Math.random()}.sock`,
  );
  const server = createServer(options, respond);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    await run(socketPath);
  } finally {
    server.close();
    await rm(socketPath, { force: true });
  }
}

async function writePiFloodFixture(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), `snapdragon-pi-flood-${process.pid}-`));
  const path = join(root, 'fixture.mjs');
  await writeFile(
    path,
    `
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', (line) => {
  const command = JSON.parse(line);
  if (command.type !== 'prompt') return;
  emit({ id: command.id, type: 'response', command: 'prompt', success: true });
  for (let index = 0; index < 700; index++) emit({ type: 'trace', index, detail: 'event-' + index });
  emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
  emit({ type: 'agent_end', messages: [] });
});
`,
    'utf8',
  );
  return { root, path };
}
