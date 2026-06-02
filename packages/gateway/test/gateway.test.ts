import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  createGatewayRestServer,
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
  assert.deepEqual(leasedStatus.queueDepths, [{ queue: 'default', pending: 0, running: 1 }]);
  assert.equal((await gateway.completeJob(job.id, { ok: true }))?.state, 'completed');
  const failed = await gateway.enqueueJob({ kind: 'agent.run', payload: { prompt: 'fail it' } });
  await gateway.acquireJob('default', 'worker-1');
  assert.equal((await gateway.failJob(failed.id, 'nope'))?.state, 'failed');
  assert.match(
    (await gateway.status()).recentFailures?.map((log) => log.message).join('\n') ?? '',
    /nope/,
  );
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
  const snapshot = await gateway.worldSnapshot();
  assert.equal(snapshot.agentRuntimes[0]?.id, 'sd');
  assert.equal(snapshot.jobs[0]?.spec.kind, 'agent.run');
  assert.equal(snapshot.status.agentRuntimes?.[0]?.protocol, 'embedded');
  assert.deepEqual(snapshot.sandboxes, []);
});

test('gateway validates agent runtime descriptors before registration', async () => {
  const gateway = new InlineGatewayClient();
  await assert.rejects(
    gateway.registerAgentRuntime({
      id: 'bad runtime',
      kind: 'codex',
      protocol: 'command',
      command: { command: 'codex' },
    }),
    /runtime id/,
  );
  await assert.rejects(
    gateway.registerAgentRuntime({
      id: 'codex',
      kind: 'codex',
      protocol: 'command',
    }),
    /requires command\.command/,
  );
  assert.equal((await gateway.listAgentRuntimes()).length, 0);
});

test('gateway REST server exposes local orchestration routes', async () => {
  const gateway = new InlineGatewayClient();
  const rest = createGatewayRestServer(gateway, { streamIntervalMs: 20 });
  const baseUrl = await rest.listen();
  try {
    assert.equal((await getJson(`${baseUrl}/health`)).runtime, 'inline-ts');
    const runtime = await postJson(`${baseUrl}/agents/register`, {
      descriptor: {
        id: 'codex',
        kind: 'codex',
        protocol: 'command',
        command: { command: 'codex', args: ['--json'] },
      },
    });
    assert.equal(runtime.id, 'codex');
    assert.equal((await getJson(`${baseUrl}/agents/codex`)).protocol, 'command');
    const invalidRuntime = await fetch(`${baseUrl}/agents/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        descriptor: { id: 'bad runtime', kind: 'codex', protocol: 'command' },
      }),
    });
    assert.equal(invalidRuntime.status, 400);
    assert.match(await invalidRuntime.text(), /runtime id/);

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
    const log = await postJson(`${baseUrl}/logs`, {
      target: job.id,
      message: 'runtime breadcrumb',
      data: { phase: 'started' },
    });
    assert.equal(log.target, job.id);
    assert.match(
      (await getJson(`${baseUrl}/logs?target=${job.id}`))
        .map((record: any) => record.message)
        .join('\n'),
      /runtime breadcrumb/,
    );
    const invalidLog = await fetch(`${baseUrl}/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: job.id }),
    });
    assert.equal(invalidLog.status, 400);
    assert.match(await invalidLog.text(), /missing log message/);
    assert.equal((await postJson(`${baseUrl}/jobs/${job.id}/cancel`, {})).state, 'cancelled');

    const world = await getJson(`${baseUrl}/world`);
    assert.equal(world.agentRuntimes[0]?.id, 'codex');
    assert.equal(Array.isArray(world.logs), true);
  } finally {
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
          command: { command: 'codex', args: ['--json'] },
          supportedJobKinds: ['agent.run'],
        })
      ).kind,
      'codex',
    );
    assert.equal((await gateway.listAgentRuntimes())[0]?.id, 'sd');
    assert.equal((await gateway.showAgentRuntime('sd'))?.protocol, 'embedded');
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
    assert.equal((await gateway.completeJob('job_1', { ok: true }))?.state, 'completed');
    assert.equal((await gateway.appendEvent({ kind: 'channel.run' })).state, 'pending');
    assert.equal((await gateway.cancelEvent('event_1'))?.state, 'cancelled');
    assert.equal(
      (await gateway.appendLog({ target: 'job_1', message: 'runtime event' })).target,
      'job_1',
    );
    assert.equal((await gateway.tailLogs()).length, 1);
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
      'tables.create',
      'tables.list',
      'tables.show',
      'jobs.enqueue',
      'jobs.acquire',
      'jobs.complete',
      'events.append',
      'events.cancel',
      'logs.append',
      'logs.tail',
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
