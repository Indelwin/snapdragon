import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { LlmChatRequest } from '@snapdragon-ai/host';
import { runOneShot } from '../src/repl.ts';
import { createSdRuntime } from '../src/runtime.ts';

test('sd memory auto-captures triggered preferences and re-injects relevant context', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-memory-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    let captured: LlmChatRequest | undefined;
    runtime.agent.setProvider(async (request) => {
      captured = request;
      return { content: 'noted' };
    });

    await runOneShot(runtime, 'remember to run pack dry before release');
    const memory = await readFile(join(workspace, 'memory', 'MEMORY.md'), 'utf8');
    assert.match(memory, /pack dry/);

    await runOneShot(runtime, 'release checklist?');
    assert.match(JSON.stringify(captured?.messages), /MEMORY.md/);
    assert.match(JSON.stringify(captured?.messages), /pack dry/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('first-party uncle-bob profile template is instantiated with profile-local memory', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-uncle-bob-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const profileRoot = join(workspace, 'profiles');

    const runtime = await createSdRuntime({
      cwd: workspace,
      configPath,
      profileRoot,
      profileName: 'uncle-bob',
      provider: 'mock',
      model: 'mock',
      noSession: true,
    });

    assert.equal(runtime.profile?.name, 'uncle-bob');
    assert.match(runtime.memory.path, /profiles\/uncle-bob\/memory\/MEMORY.md$/);
    assert.ok(runtime.skills.load('code-review'));
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('sd discovers local extension manifests without loading code', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-extensions-'));
  try {
    const extensionDir = join(workspace, 'extensions', 'local-sandbox');
    await mkdir(extensionDir, { recursive: true });
    await writeFile(
      join(extensionDir, 'snapdragon.extension.yaml'),
      [
        'id: local/sandbox',
        'name: Local Sandbox',
        'description: Local sandbox backend placeholder',
        'capabilities:',
        '  - sandbox',
        '',
      ].join('\n'),
      'utf8',
    );
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });

    assert.deepEqual(
      runtime.extensions.list().map((extension) => extension.id),
      ['local/sandbox'],
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeMockConfig(workspace: string): Promise<string> {
  const configPath = join(workspace, 'sd.yaml');
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
      `  root: "${escapeYaml(join(workspace, 'sessions'))}"`,
      'skills:',
      `  root: "${escapeYaml(join(workspace, 'skills'))}"`,
      'memory:',
      `  root: "${escapeYaml(join(workspace, 'memory'))}"`,
      'extensions:',
      '  roots:',
      `    - "${escapeYaml(join(workspace, 'extensions'))}"`,
      'toolsets:',
      '  enabled:',
      '    - file',
      '    - shell',
      '    - repl',
      '    - skill',
      '    - memory',
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"');
}
