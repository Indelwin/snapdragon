import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stringify as stringifyYaml } from 'yaml';
import { parseArgs } from '../src/args.ts';
import { runGatewayCommand } from '../src/gateway-command.ts';
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
      await runGatewayCommand({ ...args, gatewayArgs: ['agents', 'register-pi'] }),
      /registered agent runtime pi/,
    );
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
