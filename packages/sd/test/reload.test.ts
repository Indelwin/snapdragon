import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { parseArgs } from '../src/args.ts';
import { RELOAD_OUTPUT_TAIL_BYTES } from '../src/bounded-output-tail.ts';
import {
  defaultReloadShellRunner,
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
    await writeFile(
      configPath,
      `${await readFile(configPath, 'utf8')}agent:\n  max_tokens: 64000\n`,
      'utf8',
    );

    const report = await reloadSdRuntime(runtime, { runner });

    assert.equal(calls.length, 0, 'no shell-outs without pull/build');
    assert.notStrictEqual(runtime.agent, initialAgent, 'rebuild must replace the agent');
    assert.equal(report.pulled, undefined);
    assert.equal(report.built, undefined);
    assert.ok(report.durationMs >= 0);
    assert.match(report.provider, /\//);
    assert.equal(runtime.config.agent?.max_tokens, 64_000, 'bare reload re-reads data config');
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

    const initialAgent = runtime.agent;
    const report = await reloadSdRuntime(runtime, { pull: true, runner, draft: 'pending text' });

    assert.deepEqual(
      calls.map((c) => ({ command: c.command, args: c.args })),
      [{ command: 'git', args: ['pull', '--ff-only'] }],
    );
    assert.equal(calls[0].cwd, runtime.agent.cwd);
    assert.equal(report.pulled?.ok, true);
    assert.match(report.pulled?.tail ?? '', /up to date/);
    assert.strictEqual(runtime.agent, initialAgent, 'executable reload waits for a restart');
    assert.equal(report.restart?.state.sessionId, runtime.session?.sessionId);
    assert.equal(report.restart?.state.draft, 'pending text');
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

    assert.equal(labels.length, 2);
    assert.match(labels[0] ?? '', /git pull/);
    assert.match(labels[1] ?? '', /building/);
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

test('reloadSdRuntime sync runs pull then build and requests restart', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reload-sync-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const { runner, calls } = fakeRunner();

    const report = await reloadSdRuntime(runtime, { pull: true, build: true, runner });

    assert.deepEqual(
      calls.map((c) => `${c.command} ${c.args.join(' ')}`),
      ['git pull --ff-only', 'npm run build'],
    );
    assert.equal(report.restart?.kind, 'restart');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('reloadSdRuntime reports executable failures and keeps the current runtime', async () => {
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
    assert.strictEqual(runtime.agent, initialAgent, 'failed build keeps the current runtime');
    assert.equal(report.restart, undefined);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('default reload runner retains bounded stdout and stderr tails', async () => {
  const marker = 'reload-output-end';
  const result = await defaultReloadShellRunner(
    process.execPath,
    [
      '-e',
      `process.stdout.write('o'.repeat(${RELOAD_OUTPUT_TAIL_BYTES * 4}) + '${marker}');` +
        `process.stderr.write('e'.repeat(${RELOAD_OUTPUT_TAIL_BYTES * 4}) + '${marker}');`,
    ],
    process.cwd(),
  );

  assert.equal(result.code, 0);
  assert.ok(Buffer.byteLength(result.stdout) <= RELOAD_OUTPUT_TAIL_BYTES);
  assert.ok(Buffer.byteLength(result.stderr) <= RELOAD_OUTPUT_TAIL_BYTES);
  assert.match(result.stdout, new RegExp(`${marker}$`));
  assert.match(result.stderr, new RegExp(`${marker}$`));
});

test('formatReloadReport distinguishes data reloads from executable restart requests', () => {
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
  assert.doesNotMatch(text, /Restart/);

  const restartText = formatReloadReport({
    extensions: 2,
    extensionErrors: 0,
    skills: 5,
    profiles: 1,
    services: 2,
    provider: 'mock/mock',
    durationMs: 7,
    restart: {
      kind: 'restart',
      reason: 'executable_reload',
      state: { noSession: true, provider: 'mock', model: 'mock', noProfile: true },
    },
  });
  assert.match(restartText, /Reload prepared/);
  assert.match(restartText, /Restart requested after the current run drains/);
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
      assert.doesNotMatch(io.output(), /Restart/);
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
      const result = await handleCommand('/reload sync', runtime, [], io.io);
      assert.deepEqual(
        calls.map((c) => `${c.command} ${c.args.join(' ')}`),
        ['git pull --ff-only', 'npm run build'],
      );
      assert.match(io.output(), /pull\s+ok/);
      assert.match(io.output(), /build\s+ok/);
      assert.equal(result.restart?.state.sessionId, runtime.session?.sessionId);
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
