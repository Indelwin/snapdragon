import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { parseArgs } from '../src/args.ts';
import {
  formatReloadReport,
  parseReloadArg,
  type ReloadShellResult,
  reloadSdRuntime,
} from '../src/reload.ts';
import { handleCommand, type SdIo, setReloadShellRunnerForTests } from '../src/repl.ts';
import { createSdRuntime } from '../src/runtime.ts';

interface Recorded {
  command: string;
  args: string[];
  cwd: string;
}

function fakeRunner(responses: Record<string, ReloadShellResult> = {}): {
  runner: (cmd: string, args: string[], cwd: string) => Promise<ReloadShellResult>;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const runner = async (command: string, args: string[], cwd: string) => {
    calls.push({ command, args, cwd });
    const key = `${command} ${args.join(' ')}`;
    return responses[key] ?? { stdout: '', stderr: '', code: 0 };
  };
  return { runner, calls };
}

test('parseReloadArg handles bare, individual, and combined flags', () => {
  assert.deepEqual(parseReloadArg(''), { pull: false, build: false, unknown: [] });
  assert.deepEqual(parseReloadArg('pull'), { pull: true, build: false, unknown: [] });
  assert.deepEqual(parseReloadArg('build'), { pull: false, build: true, unknown: [] });
  assert.deepEqual(parseReloadArg('sync'), { pull: true, build: true, unknown: [] });
  assert.deepEqual(parseReloadArg('all'), { pull: true, build: true, unknown: [] });
  assert.deepEqual(parseReloadArg('pull build'), { pull: true, build: true, unknown: [] });
  assert.deepEqual(parseReloadArg('pull bogus'), {
    pull: true,
    build: false,
    unknown: ['bogus'],
  });
});

test('reloadSdRuntime rebuilds runtime without spawning anything by default', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-bare-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const initialAgent = runtime.agent;
    const { runner, calls } = fakeRunner();

    const report = await reloadSdRuntime(runtime, { runner });

    assert.equal(calls.length, 0, 'no shell-outs without pull/build');
    assert.notStrictEqual(runtime.agent, initialAgent, 'rebuild must replace the agent');
    assert.equal(report.pulled, undefined);
    assert.equal(report.built, undefined);
    assert.ok(report.durationMs >= 0);
    assert.match(report.provider, /\//);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('reloadSdRuntime with pull invokes git and proceeds even on success', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-pull-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const { runner, calls } = fakeRunner({
      'git pull --ff-only': { stdout: 'Already up to date.\n', stderr: '', code: 0 },
    });

    const report = await reloadSdRuntime(runtime, { pull: true, runner });

    assert.deepEqual(
      calls.map((c) => ({ command: c.command, args: c.args })),
      [{ command: 'git', args: ['pull', '--ff-only'] }],
    );
    assert.equal(calls[0].cwd, runtime.agent.cwd);
    assert.equal(report.pulled?.ok, true);
    assert.match(report.pulled?.tail ?? '', /up to date/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('reloadSdRuntime with build runs the configured build command', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-build-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const { runner, calls } = fakeRunner({
      'npm run build': { stdout: '', stderr: '', code: 0 },
    });

    const report = await reloadSdRuntime(runtime, { build: true, runner });

    assert.deepEqual(
      calls.map((c) => `${c.command} ${c.args.join(' ')}`),
      ['npm run build'],
    );
    assert.equal(report.built?.ok, true);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('reloadSdRuntime calls progress before each step', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-progress-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const { runner } = fakeRunner();
    const labels: string[] = [];

    await reloadSdRuntime(runtime, {
      pull: true,
      build: true,
      runner,
      progress: (label) => labels.push(label),
    });

    // Three beats: pull → build → rebuild. Bare reload only fires the rebuild
    // beat; tested separately below.
    assert.equal(labels.length, 3);
    assert.match(labels[0] ?? '', /git pull/);
    assert.match(labels[1] ?? '', /building/);
    assert.match(labels[2] ?? '', /rebuilding/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('reloadSdRuntime bare reload still emits the rebuild progress beat', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-progress-bare-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const labels: string[] = [];

    await reloadSdRuntime(runtime, { progress: (label) => labels.push(label) });

    assert.deepEqual(labels.length, 1);
    assert.match(labels[0] ?? '', /rebuilding/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('reloadSdRuntime sync runs pull then build then rebuild', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-sync-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const { runner, calls } = fakeRunner();

    await reloadSdRuntime(runtime, { pull: true, build: true, runner });

    assert.deepEqual(
      calls.map((c) => `${c.command} ${c.args.join(' ')}`),
      ['git pull --ff-only', 'npm run build'],
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('reloadSdRuntime reports failures but still rebuilds runtime', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-fail-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const initialAgent = runtime.agent;
    const { runner } = fakeRunner({
      'npm run build': { stdout: '', stderr: 'TS1234: oops\n', code: 1 },
    });

    const report = await reloadSdRuntime(runtime, { build: true, runner });

    assert.equal(report.built?.ok, false);
    assert.match(report.built?.tail ?? '', /TS1234/);
    assert.notStrictEqual(runtime.agent, initialAgent, 'rebuild still runs after a build failure');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('formatReloadReport always includes the restart-required disclosure', () => {
  const text = formatReloadReport({
    extensions: 2,
    extensionErrors: 0,
    skills: 5,
    profiles: 1,
    services: 2,
    provider: 'mock/mock',
    durationMs: 7,
  });
  assert.match(text, /Reload complete/);
  assert.match(text, /extensions: 2/);
  assert.match(text, /Restart required for changes to:/);
  assert.match(text, /@snapdragon-ai\/host/);
  assert.match(text, /@snapdragon-ai\/agent/);
  assert.match(text, /@snapdragon-ai\/tools/);
  assert.match(text, /@snapdragon-ai\/sd/);
});

test('formatReloadReport surfaces extension errors when present', () => {
  const text = formatReloadReport({
    extensions: 3,
    extensionErrors: 1,
    skills: 0,
    profiles: 0,
    services: 0,
    provider: 'mock/mock',
    durationMs: 1,
  });
  assert.match(text, /extensions: 3 \(1 errors\)/);
});

test('handleCommand /reload routes through reloadSdRuntime and prints the report', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-cmd-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const { runner, calls } = fakeRunner();
    setReloadShellRunnerForTests(runner);
    try {
      const io = memoryIo();
      await handleCommand('/reload', runtime, [], io.io);
      assert.equal(calls.length, 0, 'bare /reload does not shell out');
      assert.match(io.output(), /Reload complete/);
      assert.match(io.output(), /Restart required/);
    } finally {
      setReloadShellRunnerForTests(undefined);
    }
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('handleCommand /reload sync triggers pull and build through the injected runner', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-sync-cmd-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const { runner, calls } = fakeRunner();
    setReloadShellRunnerForTests(runner);
    try {
      const io = memoryIo();
      await handleCommand('/reload sync', runtime, [], io.io);
      assert.deepEqual(
        calls.map((c) => `${c.command} ${c.args.join(' ')}`),
        ['git pull --ff-only', 'npm run build'],
      );
      assert.match(io.output(), /pull\s+ok/);
      assert.match(io.output(), /build\s+ok/);
    } finally {
      setReloadShellRunnerForTests(undefined);
    }
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('handleCommand /reload rejects unknown sub-args without rebuilding', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-bad-arg-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const initialAgent = runtime.agent;
    const io = memoryIo();
    await handleCommand('/reload bogus', runtime, [], io.io);
    assert.match(io.output(), /Unknown \/reload argument/);
    assert.strictEqual(runtime.agent, initialAgent, 'no rebuild on bad argument');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeMockConfig(workspace: string): Promise<string> {
  const configPath = join(workspace, 'sd.yaml');
  await mkdir(workspace, { recursive: true });
  await writeFile(
    configPath,
    [
      'version: 1',
      'default_provider: mock',
      'providers:',
      '  mock:',
      '    kind: mock',
      '    model: mock',
      'sessions:',
      `  root: "${join(workspace, 'sessions').replace(/"/g, '\\"')}"`,
      'toolsets:',
      '  enabled:',
      '    - file',
      '    - shell',
      '    - repl',
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

function memoryIo(): { io: SdIo; output(): string; error(): string } {
  let output = '';
  let error = '';
  return {
    io: {
      input: Readable.from([]),
      output: new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        },
      }),
      error: new Writable({
        write(chunk, _encoding, callback) {
          error += chunk.toString();
          callback();
        },
      }),
    },
    output: () => output,
    error: () => error,
  };
}
