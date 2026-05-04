import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { parseArgs } from '../src/args.ts';
import { handleCommand, runOneShot, type SdIo } from '../src/repl.ts';
import { createSdRuntime } from '../src/runtime.ts';
import { runtimeSessionStore } from '../src/runtime-session.ts';

test('createSdRuntime creates a fresh JSONL session and persists prompts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-runtime-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const io = memoryIo();

    await runOneShot(runtime, 'hello', [], io.io);

    assert.ok(runtime.session);
    assert.match(io.output(), /mock response/);
    assert.deepEqual(
      runtime.session.messages().map((message) => message.role),
      ['user', 'assistant'],
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('createSdRuntime can disable sessions', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-runtime-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(
      parseArgs(['--config', configPath, '--cwd', workspace, '--no-session']),
    );
    assert.equal(runtime.session, undefined);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('createSdRuntime resumes an existing JSONL session and appends to it', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-resume-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const first = await createSdRuntime({
      cwd: workspace,
      configPath,
      sessionId: 'alpha',
    });

    await runOneShot(first, 'hello', [], memoryIo().io);

    const resumed = await createSdRuntime({
      cwd: workspace,
      configPath,
      sessionId: 'alpha',
      resume: true,
    });

    assert.equal(resumed.session?.sessionId, 'alpha');
    assert.equal(resumed.agent.messages.length, 0, 'resume must not eagerly hydrate agent memory');
    assert.deepEqual(
      resumed.session?.messages().map((message) => message.role),
      ['user', 'assistant'],
    );

    await runOneShot(resumed, 'again', [], memoryIo().io);

    assert.deepEqual(
      resumed.session?.messages().map((message) => message.role),
      ['user', 'assistant', 'user', 'assistant'],
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('createSdRuntime restores provider and model from resumed session metadata', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-resume-provider-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const first = await createSdRuntime({
      cwd: workspace,
      configPath,
      sessionId: 'alpha',
    });
    first.session?.appendMeta({
      provider: 'openai-codex',
      model: 'gpt-5.5',
      provider_kind: 'openai-codex',
    });

    const resumed = await createSdRuntime({
      cwd: workspace,
      configPath,
      sessionId: 'alpha',
      resume: true,
    });

    assert.equal(resumed.provider.id, 'openai-codex');
    assert.equal(resumed.provider.model, 'gpt-5.5');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('createSdRuntime CLI provider and model override resumed session metadata', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-resume-provider-override-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const first = await createSdRuntime({
      cwd: workspace,
      configPath,
      sessionId: 'alpha',
    });
    first.session?.appendMeta({
      provider: 'openai-codex',
      model: 'gpt-5.5',
      provider_kind: 'openai-codex',
    });

    const resumed = await createSdRuntime({
      cwd: workspace,
      configPath,
      sessionId: 'alpha',
      resume: true,
      provider: 'mock',
      model: 'mock-cli',
    });

    assert.equal(resumed.provider.id, 'mock');
    assert.equal(resumed.provider.model, 'mock-cli');
    assert.equal(resumed.session?.metadata().provider, 'mock');
    assert.equal(resumed.session?.metadata().model, 'mock-cli');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('createSdRuntime falls back when resumed session provider is not configured', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-resume-provider-missing-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const first = await createSdRuntime({
      cwd: workspace,
      configPath,
      sessionId: 'alpha',
    });
    first.session?.appendMeta({
      provider: 'missing-provider',
      model: 'missing-model',
      provider_kind: 'missing',
    });

    const resumed = await createSdRuntime({
      cwd: workspace,
      configPath,
      sessionId: 'alpha',
      resume: true,
    });

    assert.equal(resumed.provider.id, 'mock');
    assert.equal(resumed.provider.model, 'mock');
    assert.match(resumed.warnings.join('\n'), /missing-provider/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('createSdRuntime loads sticky profiles unless disabled by CLI options', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-sticky-profile-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const profileRoot = join(workspace, 'profiles');
    await writeProfile(profileRoot, 'limited', [
      'name: limited',
      'model:',
      '  provider: mock',
      '  name: mock-profile',
      '',
    ]);
    await writeFile(join(profileRoot, '_active'), 'limited\n', 'utf8');

    const runtime = await createSdRuntime({ cwd: workspace, configPath, profileRoot });
    const plain = await createSdRuntime({
      cwd: workspace,
      configPath,
      profileRoot,
      noProfile: true,
    });

    assert.equal(runtime.profile?.name, 'limited');
    assert.equal(runtime.provider.model, 'mock-profile');
    assert.equal(plain.profile, undefined);
    assert.equal(plain.provider.model, 'mock');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('REPL tools command shows enabled tools after registry filtering', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tools-'));
  try {
    const configPath = await writeMockConfig(workspace, ['run_shell']);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const io = memoryIo();

    await handleCommand('/tools', runtime, [], io.io);

    assert.match(io.output(), /read_file/);
    assert.match(io.output(), /repl_eval/);
    assert.doesNotMatch(io.output(), /run_shell/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('REPL provider and model commands switch the active runtime provider', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-provider-switch-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    runtime.config.providers.other = { kind: 'mock', model: 'mock-alt', models: ['mock-alt'] };
    const io = memoryIo();

    await handleCommand('/provider other', runtime, [], io.io);
    assert.equal(runtime.provider.id, 'other');
    assert.equal(runtime.provider.model, 'mock-alt');
    assert.equal(runtime.session?.metadata().provider, 'other');
    assert.equal(runtime.session?.metadata().model, 'mock-alt');
    assert.match(io.output(), /Switched to other\/mock-alt/);

    await handleCommand('/model mock-next', runtime, [], io.io);
    assert.equal(runtime.provider.id, 'other');
    assert.equal(runtime.provider.model, 'mock-next');
    assert.equal(runtime.session?.metadata().provider, 'other');
    assert.equal(runtime.session?.metadata().model, 'mock-next');
    assert.match(io.output(), /Switched to other\/mock-next/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('REPL profile and session commands rebuild runtime state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-profile-command-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const profileRoot = join(workspace, 'profiles');
    await writeProfile(profileRoot, 'limited', [
      'name: limited',
      'description: no shell',
      'model:',
      '  provider: mock',
      '  name: mock-profile',
      'toolsets:',
      '  disabled:',
      '    - shell',
      '',
    ]);
    const runtime = await createSdRuntime({
      cwd: workspace,
      configPath,
      profileRoot,
      sessionId: 'alpha',
    });
    runtimeSessionStore(runtime.config).create('codex-session', {
      app: 'sd',
      provider: 'openai-codex',
      model: 'gpt-5.5',
      provider_kind: 'openai-codex',
      cwd: workspace,
      profile: null,
    });
    const io = memoryIo();

    await handleCommand('/profile limited', runtime, [], io.io);

    assert.equal(runtime.profile?.name, 'limited');
    assert.equal(runtime.provider.model, 'mock-profile');
    assert.notEqual(runtime.session?.sessionId, 'alpha');
    assert.match(runtime.sessionRoot ?? '', /profiles\/limited\/sessions$/);
    assert.equal(
      runtime.agent.registry.listEnabled().some((tool) => tool.name === 'run_shell'),
      false,
    );
    assert.match(io.output(), /Profile active: limited/);

    await handleCommand('/new-session beta', runtime, [], io.io);
    assert.equal(runtime.session?.sessionId, 'beta');

    await handleCommand('/resume beta', runtime, [], io.io);
    assert.equal(runtime.session?.sessionId, 'beta');

    await handleCommand('/profile none', runtime, [], io.io);
    await handleCommand('/resume codex-session', runtime, [], io.io);
    assert.equal(runtime.session?.sessionId, 'codex-session');
    assert.equal(runtime.provider.id, 'openai-codex');
    assert.equal(runtime.provider.model, 'gpt-5.5');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('REPL models command falls back to configured models when discovery fails', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-model-fallback-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    runtime.config.providers.broken = {
      kind: 'openai-compatible',
      model: 'configured-model',
      models: ['configured-model', 'second-model'],
      base_url: 'http://[::1',
    };
    const io = memoryIo();

    await handleCommand('/models broken', runtime, [], io.io);

    assert.match(io.output(), /Models for broken \(configured fallback\):/);
    assert.match(io.output(), /configured-model/);
    assert.match(io.output(), /second-model/);
    assert.match(io.output(), /live discovery failed:/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeMockConfig(workspace: string, deniedTools: string[] = []): Promise<string> {
  const configPath = join(workspace, 'sd.yaml');
  const denied = deniedTools.map((tool) => `    - ${tool}`).join('\n');
  await writeFile(
    configPath,
    [
      'version: 1',
      'default_provider: mock',
      'providers:',
      '  mock:',
      '    kind: mock',
      '    model: mock',
      '  openai-codex:',
      '    kind: openai-codex',
      '    model: gpt-5.5',
      '    models:',
      '      - gpt-5.5',
      'sessions:',
      `  root: "${join(workspace, 'sessions').replace(/"/g, '\\"')}"`,
      'toolsets:',
      '  enabled:',
      '    - file',
      '    - shell',
      '    - repl',
      '  denied_tools:',
      denied,
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

async function writeProfile(root: string, name: string, lines: string[]): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'profile.yaml'), lines.join('\n'), 'utf8');
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
