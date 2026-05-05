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
