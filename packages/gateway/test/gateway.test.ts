import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  createGatewayRestServer,
  GatewayRestClient,
  InlineGatewayClient,
  probePiRpcRuntime,
  RustGatewayClient,
  runPiRpcAgentJob,
} from '../src/index.js';

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

test('inline gateway leases, completes, and logs jobs', async () => {
  const gateway = new InlineGatewayClient();
  const job = await gateway.enqueueJob({ kind: 'agent.run', payload: { prompt: 'ship it' } });
  assert.equal(job.state, 'pending');
  const lease = await gateway.acquireJob('default', 'worker-1');
  assert.equal(lease?.job.id, job.id);
  assert.equal(lease?.lease.worker, 'worker-1');
  const leasedStatus = await gateway.status();
  assert.equal(leasedStatus.activeLeases?.[0]?.jobId, job.id);
  assert.equal(leasedStatus.activeLeases?.[0]?.worker, 'worker-1');
  assert.equal(leasedStatus.workers?.[0]?.id, 'worker-1');
  assert.equal(leasedStatus.workers?.[0]?.state, 'running');
  assert.equal(leasedStatus.workers?.[0]?.currentJobId, job.id);
  assert.deepEqual(leasedStatus.queueDepths, [{ queue: 'default', pending: 0, running: 1 }]);
  assert.equal((await gateway.completeJob(job.id, { ok: true }))?.state, 'completed');
  assert.equal((await gateway.showWorker('worker-1'))?.state, 'idle');
  const failed = await gateway.enqueueJob({ kind: 'agent.run', payload: { prompt: 'fail it' } });
  await gateway.acquireJob('default', 'worker-1');
  assert.equal((await gateway.failJob(failed.id, 'nope'))?.state, 'failed');
  assert.match(
    (await gateway.status()).recentFailures?.map((log) => log.message).join('\n') ?? '',
    /nope/,
  );
  const retried = await gateway.enqueueJob({
    kind: 'agent.run',
    payload: { prompt: 'retry it' },
    maxAttempts: 2,
  });
  await gateway.acquireJob('default', 'worker-1');
  assert.equal((await gateway.failJob(retried.id, 'try again'))?.state, 'pending');
  assert.equal((await gateway.showJob(retried.id))?.attempts, 1);
  await gateway.acquireJob('default', 'worker-1');
  assert.equal((await gateway.failJob(retried.id, 'out of tries'))?.state, 'failed');
  assert.equal((await gateway.retryJob(retried.id))?.state, 'pending');
  assert.equal((await gateway.acquireJob('default', 'worker-1'))?.job.id, retried.id);
  assert.equal((await gateway.completeJob(retried.id, { ok: true }))?.state, 'completed');
  const cancelled = await gateway.enqueueJob({ kind: 'agent.run', payload: { prompt: 'stop it' } });
  await gateway.acquireJob('default', 'worker-1');
  assert.equal((await gateway.cancelJob(cancelled.id))?.state, 'cancelled');
  assert.equal((await gateway.status()).activeLeases?.length, 0);
  assert.equal((await gateway.completeJob(cancelled.id, { late: true }))?.state, 'cancelled');
  assert.equal((await gateway.failJob(cancelled.id, 'late'))?.state, 'cancelled');
  assert.equal(
    (await gateway.appendLog({ target: cancelled.id, message: 'runtime breadcrumb' })).target,
    cancelled.id,
  );
  assert.match((await gateway.tailLogs({ limit: 5 })).map((log) => log.message).join('\n'), /job/);
});

test('inline gateway registers agent runtimes and snapshots the world', async () => {
  const gateway = new InlineGatewayClient();
  await gateway.registerAgentRuntime({
    id: 'sd',
    kind: 'sd',
    protocol: 'embedded',
    supportedJobKinds: ['agent.run'],
    capabilities: ['tools.shell'],
    isolation: 'profile',
  });
  await gateway.enqueueJob({ kind: 'agent.run', payload: { prompt: 'map the world' } });
  await gateway.registerWorker({
    id: 'agent-jobs-1',
    queue: 'default',
    runtimeId: 'sd',
    capabilities: ['agent.run'],
  });
  await gateway.registerSandboxLease(sandboxLease('lease_world'));
  const snapshot = await gateway.worldSnapshot();
  assert.equal(snapshot.agentRuntimes[0]?.id, 'sd');
  assert.equal(snapshot.workers[0]?.id, 'agent-jobs-1');
  assert.deepEqual(snapshot.workerProcesses, []);
  assert.equal(snapshot.jobs[0]?.spec.kind, 'agent.run');
  assert.equal(snapshot.status.agentRuntimes?.[0]?.protocol, 'embedded');
  assert.equal(snapshot.sandboxes[0]?.id, 'lease_world');
});

test('gateway REST server exposes local orchestration routes', async () => {
  const gateway = new InlineGatewayClient();
  const rest = createGatewayRestServer(gateway, { streamIntervalMs: 20 });
  const baseUrl = await rest.listen();
  try {
    assert.equal((await getJson(`${baseUrl}/health`)).runtime, 'inline-ts');
    const runtime = await postJson(`${baseUrl}/agents/register`, {
      descriptor: { id: 'codex', kind: 'codex', protocol: 'command' },
    });
    assert.equal(runtime.id, 'codex');
    assert.equal((await getJson(`${baseUrl}/agents/codex`)).protocol, 'command');
    const worker = await postJson(`${baseUrl}/workers/register`, {
      id: 'rest-worker',
      queue: 'default',
      runtimeId: 'codex',
      capabilities: ['agent.run'],
    });
    assert.equal(worker.id, 'rest-worker');
    assert.equal((await getJson(`${baseUrl}/workers/rest-worker`)).runtimeId, 'codex');
    const heartbeat = await postJson(`${baseUrl}/workers/rest-worker/heartbeat`, {
      state: 'idle',
      status: 'waiting',
    });
    assert.equal(heartbeat.status, 'waiting');
    assert.equal((await getJson(`${baseUrl}/workers`))[0]?.id, 'rest-worker');

    const service = await postJson(`${baseUrl}/services`, { spec: { name: 'pulse' } });
    assert.equal(service.name, 'pulse');
    assert.equal((await postJson(`${baseUrl}/services/pulse/run`, {})).runs, 1);
    const services = await postJson(`${baseUrl}/services/pulse/enable`, { enabled: false });
    assert.equal(services.find((status: any) => status.name === 'pulse')?.enabled, false);

    const event = await postJson(`${baseUrl}/events`, {
      kind: 'channel.run',
      payload: { source: 'rest' },
    });
    assert.equal(event.state, 'pending');
    assert.equal((await getJson(`${baseUrl}/events`))[0]?.id, event.id);
    assert.equal((await postJson(`${baseUrl}/events/${event.id}/cancel`, {})).state, 'cancelled');

    const job = await postJson(`${baseUrl}/jobs`, {
      spec: { kind: 'agent.run', payload: { prompt: 'from REST' } },
    });
    assert.equal(job.state, 'pending');
    assert.equal((await getJson(`${baseUrl}/jobs/${job.id}`)).id, job.id);
    await gateway.acquireJob('default', 'rest-worker');
    assert.equal((await gateway.failJob(job.id, 'rest failure'))?.state, 'failed');
    assert.equal((await postJson(`${baseUrl}/jobs/${job.id}/retry`, {})).state, 'pending');
    assert.equal((await postJson(`${baseUrl}/jobs/${job.id}/cancel`, {})).state, 'cancelled');

    const sandbox = await postJson(`${baseUrl}/sandboxes/register`, {
      lease: sandboxLease('lease_rest', 'sandbox_rest'),
    });
    assert.equal(sandbox.id, 'lease_rest');
    assert.equal((await getJson(`${baseUrl}/sandboxes/lease_rest`)).sandboxId, 'sandbox_rest');
    assert.equal((await getJson(`${baseUrl}/sandboxes`))[0]?.id, 'lease_rest');
    assert.equal((await postJson(`${baseUrl}/sandboxes/lease_rest/release`, {})).id, 'lease_rest');
    assert.equal((await getJson(`${baseUrl}/sandboxes`)).length, 0);

    const world = await getJson(`${baseUrl}/world`);
    assert.equal(world.agentRuntimes[0]?.id, 'codex');
    assert.equal(Array.isArray(world.logs), true);
  } finally {
    await rest.close();
  }
});

test('gateway REST client wraps route contracts and streams world snapshots', async () => {
  const gateway = new InlineGatewayClient();
  const rest = createGatewayRestServer(gateway, { streamIntervalMs: 20 });
  const baseUrl = await rest.listen();
  const client = new GatewayRestClient({ baseUrl });
  const controller = new AbortController();
  try {
    assert.equal((await client.health()).runtime, 'inline-ts');
    const runtime = await client.registerAgentRuntime({
      id: 'hermes',
      kind: 'hermes',
      protocol: 'command',
    });
    assert.equal(runtime.id, 'hermes');
    assert.equal(await client.showAgentRuntime('missing'), undefined);
    assert.equal((await client.listAgentRuntimes())[0]?.id, 'hermes');

    const worker = await client.registerWorker({
      id: 'rest-client-worker',
      queue: 'default',
      capabilities: ['agent.run'],
    });
    assert.equal(worker.id, 'rest-client-worker');
    const heartbeat = await client.heartbeatWorker({ id: worker.id, status: 'ready' });
    assert.equal(heartbeat?.status, 'ready');
    assert.equal((await client.showWorker(worker.id))?.id, worker.id);

    const service = await client.registerService({ name: 'rest-client-service' });
    assert.equal(service.name, 'rest-client-service');
    assert.equal((await client.runService(service.name))?.runs, 1);
    assert.equal(
      (await client.enableService(service.name, false)).find((item) => item.name === service.name)
        ?.enabled,
      false,
    );

    const event = await client.appendEvent({ kind: 'channel.run', payload: { source: 'client' } });
    assert.equal(event.state, 'pending');
    assert.equal((await client.cancelEvent(event.id))?.state, 'cancelled');

    const job = await client.enqueueJob({ kind: 'agent.run', payload: { prompt: 'from client' } });
    assert.equal(job.state, 'pending');
    assert.equal((await client.showJob(job.id))?.id, job.id);
    assert.equal((await client.cancelJob(job.id))?.state, 'cancelled');

    await gateway.appendLog({ target: job.id, message: 'client-visible log' });
    assert.equal(
      (await client.tailLogs({ target: job.id })).some(
        (log) => log.message === 'client-visible log',
      ),
      true,
    );
    assert.deepEqual(await client.capabilities(), {});

    const lease = await client.registerSandboxLease(sandboxLease('lease_client', 'sandbox_client'));
    assert.equal(lease.id, 'lease_client');
    assert.equal((await client.showSandboxLease(lease.id))?.sandboxId, 'sandbox_client');
    assert.equal((await client.releaseSandboxLease(lease.id))?.id, lease.id);

    const stream = client
      .streamWorldSnapshots({ signal: controller.signal })
      [Symbol.asyncIterator]();
    const snapshot = await stream.next();
    assert.equal(snapshot.value?.runtime, 'inline-ts');
    controller.abort();
    await stream.return?.();
  } finally {
    controller.abort();
    await rest.close();
  }
});

test('Pi RPC adapter probes runtime descriptors over JSONL', async () => {
  const fixture = await writePiRpcFixture();
  try {
    const descriptor = await probePiRpcRuntime({
      command: process.execPath,
      args: [fixture],
      timeoutMs: 3_000,
    });
    assert.equal(descriptor.id, 'pi');
    assert.equal(descriptor.kind, 'pi');
    assert.equal(descriptor.protocol, 'jsonl');
    assert.equal(descriptor.health?.state, 'ok');
    assert.equal(descriptor.metadata?.commandCount, 2);
    assert.equal((descriptor.metadata?.state as any)?.sessionId, 'fake-session');
  } finally {
    await rm(dirname(fixture), { force: true, recursive: true });
  }
});

test('Pi RPC adapter runs prompts, handles extension UI, and returns output', async () => {
  const fixture = await writePiRpcFixture();
  try {
    const result = await runPiRpcAgentJob(
      { prompt: 'hello from snapdragon', targetRuntimeId: 'pi' },
      { command: process.execPath, args: [fixture], timeoutMs: 3_000 },
    );
    assert.equal(result.content, 'hello from fake pi');
    assert.equal(result.summary, 'hello from fake pi');
    assert.equal(result.metrics.extension_ui_requests, 1);
    assert.equal(
      result.events.some((event) => event.type === 'extension_ui_request'),
      true,
    );
  } finally {
    await rm(dirname(fixture), { force: true, recursive: true });
  }
});

test('Pi RPC adapter rejects pre-aborted runs before spawning', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runPiRpcAgentJob(
      { prompt: 'do not start', targetRuntimeId: 'pi' },
      { command: 'pi-rpc-fixture-that-should-not-spawn', signal: controller.signal },
    ),
    /aborted/,
  );
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
    const status = await gateway.status();
    assert.equal(status.pid, 42);
    assert.equal(status.workers?.[0]?.id, 'worker');
    assert.equal(status.workers?.[0]?.state, 'running');
    assert.deepEqual(status.serviceTasks, ['memory-worker']);
    assert.equal(status.workerProcesses?.[0]?.pid, 123);
    assert.equal(status.workerProcesses?.[0]?.state, 'running');
    assert.equal(status.activeLeases?.[0]?.jobId, 'job_1');
    assert.deepEqual(status.queueDepths, [{ queue: 'default', pending: 2, running: 1 }]);
    assert.equal(status.recentFailures?.[0]?.message, 'worker failed');
    assert.equal(status.services[0]?.state, 'running');
    assert.equal(status.services[0]?.consecutiveErrors, 2);
    assert.equal(status.services[0]?.restartSuppressed, true);
    assert.equal((await gateway.receive({ id: 'worker' }))?.target.id, 'worker');
    assert.deepEqual(await gateway.whereisCapability('memory.read'), [{ id: 'worker' }]);
    assert.deepEqual(await gateway.registrySnapshot(), {
      names: {},
      capabilities: { 'memory.read': [{ id: 'worker' }] },
      channels: {},
    });
    assert.equal(status.agentRuntimes?.[0]?.id, 'sd');
    assert.equal(
      (
        await gateway.registerAgentRuntime({
          id: 'codex',
          kind: 'codex',
          protocol: 'command',
          supportedJobKinds: ['agent.run'],
        })
      ).kind,
      'codex',
    );
    assert.equal((await gateway.listAgentRuntimes())[0]?.id, 'sd');
    assert.equal((await gateway.showAgentRuntime('sd'))?.protocol, 'embedded');
    assert.equal(
      (
        await gateway.registerWorker({
          id: 'worker',
          queue: 'default',
          runtimeId: 'sd',
          capabilities: ['agent.run'],
        })
      ).runtimeId,
      'sd',
    );
    assert.equal(
      (await gateway.heartbeatWorker({ id: 'worker', status: 'ready' }))?.status,
      'ready',
    );
    assert.equal((await gateway.listWorkers())[0]?.id, 'worker');
    assert.equal((await gateway.showWorker('worker'))?.queue, 'default');
    assert.equal(await gateway.createTable('state', { id: 'worker' }, 'private'), true);
    assert.deepEqual(await gateway.tableNames(), ['state']);
    assert.deepEqual(await gateway.tableSnapshot('state'), {
      name: 'state',
      owner: { id: 'worker' },
      access: 'private',
      rows: 0,
    });
    const job = await gateway.enqueueJob({ kind: 'agent.run', payload: { prompt: 'test' } });
    assert.equal(job.id, 'job_1');
    assert.equal((await gateway.acquireJob('default', 'worker'))?.lease.worker, 'worker');
    assert.equal((await gateway.failJob('job_1', 'try again'))?.state, 'failed');
    assert.equal((await gateway.retryJob('job_1'))?.state, 'pending');
    assert.equal((await gateway.completeJob('job_1', { ok: true }))?.state, 'completed');
    assert.equal((await gateway.appendEvent({ kind: 'channel.run' })).state, 'pending');
    assert.equal((await gateway.cancelEvent('event_1'))?.state, 'cancelled');
    assert.equal(
      (await gateway.appendLog({ target: 'job_1', message: 'runtime event' })).target,
      'job_1',
    );
    assert.equal((await gateway.tailLogs()).length, 1);
    assert.equal((await gateway.registerSandboxLease(sandboxLease('lease_1'))).id, 'lease_1');
    assert.equal((await gateway.listSandboxLeases())[0]?.id, 'lease_1');
    assert.equal((await gateway.showSandboxLease('lease_1'))?.cwd, '/tmp/sandbox');
    assert.equal((await gateway.releaseSandboxLease('lease_1'))?.id, 'lease_1');
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
      'agents.register',
      'agents.list',
      'agents.show',
      'workers.register',
      'workers.heartbeat',
      'workers.list',
      'workers.show',
      'tables.create',
      'tables.list',
      'tables.show',
      'jobs.enqueue',
      'jobs.acquire',
      'jobs.fail',
      'jobs.retry',
      'jobs.complete',
      'events.append',
      'events.cancel',
      'logs.append',
      'logs.tail',
      'sandboxes.register',
      'sandboxes.list',
      'sandboxes.show',
      'sandboxes.release',
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
        worker_processes: [
          {
            id: 'worker_1',
            service: 'memory-worker',
            pid: 123,
            command: 'node',
            args: ['worker.js'],
            cwd: '/tmp/sd',
            started_at_ms: 10,
            finished_at_ms: null,
            timeout_ms: 1000,
            state: 'Running',
            exit_code: null,
            signal: null,
            last_error: null,
          },
        ],
        tables: [],
        service_tasks: ['memory-worker'],
        agent_runtimes: [wireAgentRuntime()],
        workers: [wireWorkerRecord()],
        jobs_pending: 2,
        jobs_running: 1,
        active_leases: [
          {
            id: 'lease_1',
            job_id: 'job_1',
            worker: 'worker',
            acquired_at_ms: 10,
            expires_at_ms: 20,
          },
        ],
        queue_depths: [{ queue: 'default', pending: 2, running: 1 }],
        recent_failures: [{ id: 1, at_ms: 10, level: 'error', message: 'worker failed' }],
        uptime_ms: 5000,
        pid: 42,
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
  if (request.method === 'agents.register') {
    return { id: request.id, ok: true, result: request.params.descriptor };
  }
  if (request.method === 'agents.list') {
    return { id: request.id, ok: true, result: [wireAgentRuntime()] };
  }
  if (request.method === 'agents.show') {
    return { id: request.id, ok: true, result: wireAgentRuntime(request.params.id) };
  }
  if (request.method === 'workers.register') {
    return { id: request.id, ok: true, result: wireWorkerRecord(request.params.worker) };
  }
  if (request.method === 'workers.heartbeat') {
    return {
      id: request.id,
      ok: true,
      result: wireWorkerRecord({
        id: request.params.heartbeat.id,
        status: request.params.heartbeat.status,
      }),
    };
  }
  if (request.method === 'workers.list') {
    return { id: request.id, ok: true, result: [wireWorkerRecord()] };
  }
  if (request.method === 'workers.show') {
    return { id: request.id, ok: true, result: wireWorkerRecord({ id: request.params.id }) };
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
  if (request.method === 'jobs.enqueue') {
    return { id: request.id, ok: true, result: wireJobStatus('job_1', request.params.spec) };
  }
  if (request.method === 'jobs.acquire') {
    return {
      id: request.id,
      ok: true,
      result: {
        job: wireJobStatus('job_1', {
          kind: 'agent.run',
          queue: 'default',
          payload: {},
          priority: 0,
          max_attempts: 1,
        }),
        lease: {
          id: 'lease_1',
          job_id: 'job_1',
          worker: request.params.worker,
          acquired_at_ms: 10,
          expires_at_ms: 20,
        },
      },
    };
  }
  if (request.method === 'jobs.complete') {
    return {
      id: request.id,
      ok: true,
      result: {
        ...wireJobStatus(request.params.id),
        state: 'Completed',
        result: request.params.result,
      },
    };
  }
  if (request.method === 'jobs.fail') {
    return {
      id: request.id,
      ok: true,
      result: {
        ...wireJobStatus(request.params.id),
        state: 'Failed',
        last_error: request.params.error,
      },
    };
  }
  if (request.method === 'jobs.retry') {
    return {
      id: request.id,
      ok: true,
      result: { ...wireJobStatus(request.params.id), state: 'Pending' },
    };
  }
  if (request.method === 'events.append') {
    return { id: request.id, ok: true, result: wireEvent('event_1', 'Pending') };
  }
  if (request.method === 'events.cancel') {
    return { id: request.id, ok: true, result: wireEvent(request.params.id, 'Cancelled') };
  }
  if (request.method === 'logs.append') {
    return {
      id: request.id,
      ok: true,
      result: {
        id: 1,
        at_ms: request.params.at_ms,
        level: request.params.level,
        target: request.params.target,
        message: request.params.message,
        data: request.params.data,
      },
    };
  }
  if (request.method === 'logs.tail') {
    return {
      id: request.id,
      ok: true,
      result: [{ id: 1, at_ms: 10, level: 'info', message: 'ok' }],
    };
  }
  if (request.method === 'sandboxes.register') {
    return { id: request.id, ok: true, result: request.params.lease };
  }
  if (request.method === 'sandboxes.list') {
    return { id: request.id, ok: true, result: [wireSandboxLease()] };
  }
  if (request.method === 'sandboxes.show') {
    return { id: request.id, ok: true, result: wireSandboxLease(request.params.id) };
  }
  if (request.method === 'sandboxes.release') {
    return { id: request.id, ok: true, result: wireSandboxLease(request.params.id) };
  }
  return { id: request.id, ok: true, result: true };
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true);
  return response.json();
}

function wireServiceStatus(name: string): unknown {
  return {
    name,
    enabled: true,
    state: 'Running',
    runs: 0,
    errors: 0,
    consecutive_errors: 2,
    last_run_at_ms: null,
    last_error: null,
    last_summary: null,
    restart_suppressed: true,
    next_run_at_ms: 20,
    last_exit_reason: 'error',
  };
}

function wireJobStatus(id: string, spec: any = {}): unknown {
  return {
    id,
    spec: {
      kind: spec.kind ?? 'agent.run',
      queue: spec.queue ?? 'default',
      payload: spec.payload ?? {},
      priority: spec.priority ?? 0,
      max_attempts: spec.max_attempts ?? 1,
      timeout_ms: spec.timeout_ms ?? null,
    },
    state: 'Pending',
    attempts: 0,
    created_at_ms: 10,
    updated_at_ms: 10,
  };
}

function wireEvent(id: string, state: string): unknown {
  return {
    id,
    kind: 'channel.run',
    target: null,
    state,
    payload: {},
    created_at_ms: 10,
    updated_at_ms: 10,
  };
}

function wireAgentRuntime(id = 'sd'): unknown {
  return {
    id,
    kind: id === 'sd' ? 'sd' : 'custom',
    protocol: id === 'sd' ? 'embedded' : 'command',
    label: null,
    command: null,
    supported_job_kinds: ['agent.run'],
    capabilities: [],
    isolation: null,
    health: null,
    metadata: null,
  };
}

function wireWorkerRecord(worker: any = {}): unknown {
  return {
    id: worker.id ?? 'worker',
    queue: worker.queue ?? 'default',
    runtime_id: worker.runtimeId ?? worker.runtime_id ?? null,
    service: worker.service ?? null,
    capabilities: worker.capabilities ?? ['agent.run'],
    state: worker.state ?? 'running',
    registered_at_ms: 10,
    heartbeat_at_ms: 20,
    current_job_id: worker.currentJobId ?? worker.current_job_id ?? 'job_1',
    current_lease_id: worker.currentLeaseId ?? worker.current_lease_id ?? 'lease_1',
    lease_expires_at_ms: worker.leaseExpiresAtMs ?? worker.lease_expires_at_ms ?? 30,
    status: worker.status ?? null,
    last_error: worker.lastError ?? worker.last_error ?? null,
    metadata: worker.metadata ?? null,
  };
}

function sandboxLease(id = 'lease_1', sandboxId = 'sandbox_1'): any {
  const now = Date.now();
  return {
    id,
    sandboxId,
    cwd: '/tmp/sandbox',
    acquiredAtMs: now,
    expiresAtMs: now + 60_000,
    backend: 'worktree',
    project: { id: 'project_1', root: '/tmp/project' },
    referenceRoots: ['/tmp/reference'],
  };
}

function wireSandboxLease(id = 'lease_1'): any {
  return {
    id,
    sandbox_id: 'sandbox_1',
    cwd: '/tmp/sandbox',
    acquired_at_ms: 10,
    expires_at_ms: 30,
    backend: 'worktree',
    project: { id: 'project_1', root: '/tmp/project', branch: null },
    reference_roots: ['/tmp/reference'],
  };
}

async function writePiRpcFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `snapdragon-pi-rpc-${process.pid}-`));
  const fixture = join(root, 'fake-pi-rpc.mjs');
  await writeFile(
    fixture,
    `
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin });
const emit = (message) => process.stdout.write(JSON.stringify(message) + '\\n');

rl.on('line', (line) => {
  const command = JSON.parse(line);
  if (command.type === 'get_state') {
    emit({
      id: command.id,
      type: 'response',
      command: 'get_state',
      success: true,
      data: { sessionId: 'fake-session', thinkingLevel: 'high', isStreaming: false },
    });
    return;
  }
  if (command.type === 'get_commands') {
    emit({
      id: command.id,
      type: 'response',
      command: 'get_commands',
      success: true,
      data: { commands: [{ name: 'vault' }, { name: 'skill:repo-processor' }] },
    });
    return;
  }
  if (command.type === 'prompt') {
    emit({ id: command.id, type: 'response', command: 'prompt', success: true });
    emit({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello ' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'hello ' },
    });
    emit({ type: 'extension_ui_request', id: 'ui-1', method: 'input', title: 'Need input' });
    return;
  }
  if (command.type === 'extension_ui_response' && command.id === 'ui-1') {
    emit({
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello from fake pi' }] },
      assistantMessageEvent: { type: 'text_delta', delta: 'from fake pi' },
    });
    emit({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello from fake pi' }] },
    });
    emit({ type: 'agent_end', messages: [] });
  }
});
`,
    'utf8',
  );
  return fixture;
}
