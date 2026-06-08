import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { InlineGatewayClient } from '@snapdragon-ai/gateway';
import { stringify as stringifyYaml } from 'yaml';
import { parseArgs } from '../src/args.ts';
import { registerAgentJobWorker, runGatewayAgentJob } from '../src/gateway-agent-job-service.ts';
import { runGatewayCommand } from '../src/gateway-command.ts';
import { registerLearnJobWorker, runLearnEvalJob } from '../src/gateway-learn-job-service.ts';
import { configuredRustGatewayServices } from '../src/gateway-rust-config.ts';
import { formatRustGatewayStatus } from '../src/gateway-rust-status.ts';

test('gateway commands inspect live Rust services, registry, and tables', async () => {
  const root = await mkGatewayRoot();
  const configPath = join(root, 'config.yaml');
  const socketPath = join(root, 'gateway.sock');
  const server = mockGatewayServer(socketPath);
  await writeGatewayConfig(configPath, root);
  await server.ready;

  try {
    const args = { configPath, gatewayArgs: [] } as any;
    assert.match(await runGatewayCommand({ ...args, gatewayArgs: ['services', 'list'] }), /rust/);
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['services', 'run', 'memory-worker'] }),
      /runs=1/,
    );
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['registry', 'list'] }),
      /memory\.read/,
    );
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['registry', 'whereis', 'memory.read'] }),
      /worker/,
    );
    assert.match(await runGatewayCommand({ ...args, gatewayArgs: ['tables', 'list'] }), /state/);
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['tables', 'show', 'state'] }),
      /owner: worker/,
    );
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['jobs', 'enqueue', 'agent.run', 'test'] }),
      /enqueued job_1/,
    );
    assert.match(await runGatewayCommand({ ...args, gatewayArgs: ['jobs', 'list'] }), /agent\.run/);
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['jobs', 'cancel', 'job_1'] }),
      /cancelled job_1/,
    );
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['agents', 'enqueue', 'test agent'] }),
      /enqueued agent job job_1/,
    );
    assert.match(
      await runGatewayCommand({
        ...args,
        gatewayArgs: ['agents', 'enqueue', '--runtime', 'pi', 'test agent'],
      }),
      /runtime=pi/,
    );
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['agents', 'list'] }),
      /pi\tpi\tjsonl/,
    );
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['agents', 'show', 'pi'] }),
      /"protocol": "jsonl"/,
    );
    assert.match(
      await runGatewayCommand({
        ...args,
        gatewayArgs: ['agents', 'register-pi', '--save', '--agent-dir', join(root, 'pi-agent')],
      }),
      /registered agent runtime pi.*saved=/,
    );
    const savedConfig = await readFile(configPath, 'utf8');
    assert.match(savedConfig, /agent_runtimes:/);
    assert.match(savedConfig, /PI_CODING_AGENT_DIR/);
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['logs', 'tail'] }),
      /gateway logs/,
    );
    const datasetPath = join(root, 'dataset.json');
    await writeFile(
      datasetPath,
      JSON.stringify({ id: 'evals/basic', examples: [{ id: '1', prompt: 'test' }] }),
    );
    assert.match(
      await runGatewayCommand({
        ...args,
        gatewayArgs: ['learn', 'enqueue-eval', datasetPath, '--id', 'eval-1'],
      }),
      /enqueued learn eval job_1/,
    );
  } finally {
    await server.close();
    await rm(root, { force: true, recursive: true });
  }
});

test('gateway agent commands surface saved runtimes when the daemon is unavailable', async () => {
  const root = await mkGatewayRoot();
  const configPath = join(root, 'config.yaml');
  await writeFile(
    configPath,
    stringifyYaml({
      version: 1,
      gateway: {
        runtime: 'rust',
        root,
        agent_runtimes: {
          pi: {
            kind: 'pi',
            protocol: 'jsonl',
            label: 'Pi Agent',
            supported_job_kinds: ['agent.run'],
          },
        },
      },
    }),
    'utf8',
  );

  try {
    const args = { configPath, gatewayArgs: [] } as any;
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['agents', 'list'] }),
      /pi\tpi\tjsonl Pi Agent\tsaved/,
    );
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['agents', 'show', 'pi'] }),
      /"id": "pi"/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('gateway agent job service records Pi runtime breadcrumbs', async () => {
  const root = await mkGatewayRoot();
  const fixture = await writePiRpcJobFixture(root);
  const gateway = new InlineGatewayClient();
  const config = piRuntimeConfig(root, fixture);
  await registerAgentJobWorker(gateway, config, 'test-worker');
  const worker = await gateway.showWorker('test-worker');
  assert.equal(worker?.service, 'agent-jobs');
  assert.deepEqual(worker?.capabilities, ['agent.run']);
  assert.deepEqual((worker?.metadata as any)?.supportedRuntimeIds, ['sd', 'pi']);
  const job = await gateway.enqueueJob({
    kind: 'agent.run',
    payload: { prompt: 'hello pi', targetRuntimeId: 'pi' },
    timeoutMs: 3_000,
  });
  const lease = await gateway.acquireJob('default', 'test-worker');
  assert.ok(lease);
  assert.equal(lease.job.id, job.id);

  try {
    const result = await runGatewayAgentJob(gateway, config, lease.job, {
      cancellationPollMs: 10,
      workerId: 'test-worker',
    });
    assert.equal(result.metrics?.completed, 1);
    assert.equal((await gateway.showJob(job.id))?.state, 'completed');
    const completedWorker = await gateway.showWorker('test-worker');
    assert.equal(completedWorker?.state, 'idle');
    assert.equal(completedWorker?.status, `completed ${job.id}`);
    assert.equal((completedWorker?.metadata as any)?.lastRuntimeId, 'pi');
    assert.deepEqual((completedWorker?.metadata as any)?.supportedRuntimeIds, ['sd', 'pi']);
    const logs = await gateway.tailLogs({ target: job.id, limit: 20 });
    assert.match(
      logs.map((log) => log.message).join('\n'),
      /agent runtime started[\s\S]*agent runtime event: agent_start[\s\S]*agent runtime event: message_end/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('gateway agent job service aborts Pi runtime when the job is cancelled', async () => {
  const root = await mkGatewayRoot();
  const fixture = await writePiRpcJobFixture(root, { hang: true });
  const gateway = new InlineGatewayClient();
  const config = piRuntimeConfig(root, fixture);
  await registerAgentJobWorker(gateway, config, 'test-worker');
  const job = await gateway.enqueueJob({
    kind: 'agent.run',
    payload: { prompt: 'wait here', targetRuntimeId: 'pi' },
    timeoutMs: 3_000,
  });
  const lease = await gateway.acquireJob('default', 'test-worker');
  assert.ok(lease);
  assert.equal(lease.job.id, job.id);

  try {
    const running = runGatewayAgentJob(gateway, config, lease.job, {
      cancellationPollMs: 10,
      workerId: 'test-worker',
    });
    await waitForLog(gateway, job.id, /agent runtime event: agent_start/);
    await gateway.cancelJob(job.id);
    const result = await running;
    assert.equal(result.metrics?.completed, 0);
    assert.equal(result.metrics?.failed, 0);
    assert.equal((await gateway.showJob(job.id))?.state, 'cancelled');
    const cancelledWorker = await gateway.showWorker('test-worker');
    assert.equal(cancelledWorker?.state, 'idle');
    assert.equal(cancelledWorker?.status, `cancelled ${job.id}`);
    const logs = await gateway.tailLogs({ target: job.id, limit: 20 });
    assert.match(logs.map((log) => log.message).join('\n'), /job cancellation observed/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('gateway learn job service registers and heartbeats learn workers', async () => {
  const gateway = new InlineGatewayClient();
  await registerLearnJobWorker(gateway, 'learn-test-worker');
  const worker = await gateway.showWorker('learn-test-worker');
  assert.equal(worker?.queue, 'learn');
  assert.equal(worker?.service, 'learn-jobs');
  assert.deepEqual(worker?.capabilities, ['learn.eval']);

  const job = await gateway.enqueueJob({
    kind: 'learn.eval',
    queue: 'learn',
    payload: {
      job: { id: 'eval-1', kind: 'eval', dataset: 'demo' },
      dataset: {
        id: 'demo',
        examples: [{ id: 'one', prompt: 'test', metadata: { output: 'ok' } }],
      },
    },
  });
  const lease = await gateway.acquireJob('learn', 'learn-test-worker');
  assert.ok(lease);
  assert.equal(lease.job.id, job.id);

  const result = await runLearnEvalJob(gateway, lease.job, { workerId: 'learn-test-worker' });
  assert.equal(result.metrics?.completed, 1);
  assert.equal((await gateway.showJob(job.id))?.state, 'completed');
  const completedWorker = await gateway.showWorker('learn-test-worker');
  assert.equal(completedWorker?.state, 'idle');
  assert.equal(completedWorker?.status, `completed learn eval ${job.id}`);
  assert.equal((completedWorker?.metadata as any)?.datasetId, 'demo');
  assert.equal(typeof (completedWorker?.metadata as any)?.score, 'number');
});

test('configured Rust gateway services point at headless sd workers', async () => {
  const root = await mkGatewayRoot();
  const configPath = join(root, 'config.yaml');
  await writeGatewayConfig(configPath, root);
  try {
    const config = {
      gateway: {
        services: {
          'memory-worker': { enabled: true, interval_ms: 60_000, timeout_ms: 1_000 },
        },
      },
    } as any;
    const [service] = configuredRustGatewayServices(config, configPath);
    assert.equal(service.name, 'memory-worker');
    assert.equal(service.worker?.command, process.execPath);
    assert.deepEqual(service.worker?.args.slice(-6), [
      'gateway',
      'worker',
      'run',
      'memory-worker',
      '--config',
      configPath,
    ]);
    assert.equal(service.worker?.cwd, process.cwd());
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('gateway worker command is parsed as gateway args while preserving config', () => {
  const parsed = parseArgs(['gateway', 'worker', 'run', 'memory-worker', '--config', './sd.yaml']);
  assert.equal(parsed.mode, 'gateway');
  assert.deepEqual(parsed.gatewayArgs, ['worker', 'run', 'memory-worker']);
  assert.match(parsed.configPath, /sd\.yaml$/);
});

test('rust gateway status shows leases, queues, service scheduling, and failures', () => {
  const text = formatRustGatewayStatus(
    {
      root: '/tmp/sd-gateway',
      pid: '/tmp/sd-gateway/daemon.pid',
      status: '/tmp/sd-gateway/status.json',
      log: '/tmp/sd-gateway/daemon.log',
      channels: '/tmp/sd-gateway/channels',
      events: '/tmp/sd-gateway/events',
      gatewaySocket: '/tmp/sd-gateway/gateway.sock',
      gatewayDb: '/tmp/sd-gateway/gateway.sqlite',
    },
    42,
    true,
    {
      runtime: 'rust',
      pid: 43,
      uptimeMs: 65_000,
      processes: 2,
      workerProcesses: [
        {
          id: 'worker_1',
          service: 'memory-worker',
          pid: 123,
          command: 'node',
          args: ['worker.js'],
          startedAtMs: 1,
          timeoutMs: 500,
          state: 'timed_out',
          lastError: 'worker timed out after 500ms',
        },
      ],
      serviceTasks: ['memory-worker'],
      tables: ['state'],
      jobsPending: 2,
      jobsRunning: 1,
      activeLeases: [
        { id: 'lease_1', jobId: 'job_1', worker: 'worker', acquiredAtMs: 1, expiresAtMs: 2 },
      ],
      queueDepths: [{ queue: 'default', pending: 2, running: 1 }],
      recentFailures: [{ id: 1, atMs: 1, level: 'error', target: 'svc', message: 'boom' }],
      services: [
        {
          name: 'memory-worker',
          enabled: true,
          state: 'failed',
          runs: 1,
          errors: 1,
          consecutiveErrors: 1,
          restartSuppressed: true,
          nextRunAtMs: 1,
        },
      ],
    },
  );
  assert.match(text, /service tasks: memory-worker/);
  assert.match(text, /workers: memory-worker:timed_out pid=123 worker timed out/);
  assert.match(text, /queues: default p=2 r=1/);
  assert.match(text, /leases: 1/);
  assert.match(text, /restart=suppressed/);
  assert.match(text, /recent failures:/);
});

async function mkGatewayRoot(): Promise<string> {
  const root = join(tmpdir(), `snapdragon-gateway-command-${process.pid}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function writeGatewayConfig(configPath: string, root: string): Promise<void> {
  await writeFile(
    configPath,
    stringifyYaml({
      version: 1,
      gateway: {
        runtime: 'rust',
        root,
        services: { 'memory-worker': { enabled: true } },
      },
    }),
    'utf8',
  );
}

function piRuntimeConfig(root: string, fixture: string): any {
  return {
    gateway: {
      root,
      agent_runtimes: {
        pi: {
          kind: 'pi',
          protocol: 'jsonl',
          label: 'Pi Agent',
          command: { command: process.execPath, args: [fixture] },
          supported_job_kinds: ['agent.run'],
        },
      },
    },
  };
}

async function writePiRpcJobFixture(
  root: string,
  options: { hang?: boolean } = {},
): Promise<string> {
  const fixture = join(root, options.hang ? 'pi-rpc-hang.cjs' : 'pi-rpc-complete.cjs');
  await writeFile(
    fixture,
    `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const hang = ${JSON.stringify(Boolean(options.hang))};
function emit(value) {
  process.stdout.write(JSON.stringify(value) + '\\n');
}
rl.on('line', (line) => {
  const command = JSON.parse(line);
  if (command.type === 'prompt') {
    emit({ id: command.id, type: 'response', command: 'prompt', success: true });
    emit({ type: 'agent_start' });
    if (hang) return;
    emit({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello from pi fixture' }] },
    });
    emit({ type: 'agent_end', messages: [] });
  }
  if (command.type === 'abort') {
    process.exit(0);
  }
});
`,
    'utf8',
  );
  return fixture;
}

async function waitForLog(
  gateway: InlineGatewayClient,
  target: string,
  pattern: RegExp,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const messages = (await gateway.tailLogs({ target, limit: 20 }))
      .map((log) => log.message)
      .join('\n');
    if (pattern.test(messages)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for log ${pattern}`);
}

function mockGatewayServer(socketPath: string) {
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) return;
      const request = JSON.parse(buffer.slice(0, lineEnd));
      socket.end(`${JSON.stringify(responseFor(request))}\n`);
    });
  });
  return {
    ready: new Promise<void>((resolve) => server.listen(socketPath, resolve)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function responseFor(request: any): unknown {
  if (request.method === 'services.list') {
    return { id: request.id, ok: true, result: [wireService('memory-worker', 0)] };
  }
  if (request.method === 'services.run') {
    return { id: request.id, ok: true, result: wireService(request.params.name, 1) };
  }
  if (request.method === 'registry.list') {
    return {
      id: request.id,
      ok: true,
      result: { names: {}, capabilities: { 'memory.read': ['worker'] }, channels: {} },
    };
  }
  if (request.method === 'registry.whereis_capability') {
    return { id: request.id, ok: true, result: ['worker'] };
  }
  if (request.method === 'tables.list') return { id: request.id, ok: true, result: ['state'] };
  if (request.method === 'tables.show') {
    return {
      id: request.id,
      ok: true,
      result: { name: request.params.name, owner: 'worker', access: 'Protected', rows: 2 },
    };
  }
  if (request.method === 'jobs.enqueue') {
    return { id: request.id, ok: true, result: wireJob('job_1', 'Pending') };
  }
  if (request.method === 'jobs.list') {
    return { id: request.id, ok: true, result: [wireJob('job_1', 'Pending')] };
  }
  if (request.method === 'jobs.cancel') {
    return { id: request.id, ok: true, result: wireJob(request.params.id, 'Cancelled') };
  }
  if (request.method === 'agents.register') {
    return { id: request.id, ok: true, result: request.params.descriptor };
  }
  if (request.method === 'agents.list') {
    return { id: request.id, ok: true, result: [wireAgentRuntime('pi')] };
  }
  if (request.method === 'agents.show') {
    return { id: request.id, ok: true, result: wireAgentRuntime(request.params.id) };
  }
  if (request.method === 'logs.tail') {
    return {
      id: request.id,
      ok: true,
      result: [{ id: 1, at_ms: 10, level: 'info', message: 'ready' }],
    };
  }
  return { id: request.id, ok: true, result: true };
}

function wireService(name: string, runs: number): unknown {
  return {
    name,
    enabled: true,
    state: 'Running',
    runs,
    errors: 0,
    last_run_at_ms: null,
    last_error: null,
    last_summary: null,
  };
}

function wireJob(id: string, state: string): unknown {
  return {
    id,
    spec: {
      kind: 'agent.run',
      queue: 'default',
      payload: { prompt: 'test' },
      priority: 0,
      max_attempts: 1,
      timeout_ms: null,
    },
    state,
    attempts: 0,
    created_at_ms: 10,
    updated_at_ms: 10,
  };
}

function wireAgentRuntime(id: string): unknown {
  return {
    id,
    kind: id === 'pi' ? 'pi' : 'custom',
    protocol: id === 'pi' ? 'jsonl' : 'command',
    label: id === 'pi' ? 'Pi Agent' : null,
    command: null,
    supported_job_kinds: ['agent.run'],
    capabilities: [],
    isolation: 'profile',
    health: null,
    metadata: null,
  };
}
