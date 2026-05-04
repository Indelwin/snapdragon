import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SessionStore } from '@snapdragon-ai/session';
import { createSdRuntime, stopSdRuntime } from '../src/runtime.ts';
import { resolveSdSessionIndexPath } from '../src/session-index.ts';

test('createSdRuntime enables session search against the configured session root', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-search-'));
  const sessionRoot = join(workspace, 'sessions');
  let runtime: Awaited<ReturnType<typeof createSdRuntime>> | undefined;
  try {
    const configPath = await writeConfig(workspace, sessionRoot);
    const session = new SessionStore({ root: sessionRoot }).create('alpha', {
      title: 'Searchable run',
    });
    session.appendMessage({
      role: 'user',
      content: 'Find the citrine gearbox in the old session.',
    });

    runtime = await createSdRuntime({
      cwd: workspace,
      configPath,
      noBackground: true,
      noSession: true,
    });
    assert.ok(runtime.sessionIndex);
    runtime.sessionIndex.sync(sessionRoot);

    assert.ok(runtime.agent.registry.listEnabled().some((tool) => tool.name === 'search_messages'));
    const result = await runtime.agent.registry.invoke('search_messages', {
      query: 'citrine gearbox',
    });

    assert.equal(result.isError, undefined);
    assert.match(result.content, /alpha/);
    assert.match(result.content, /citrine gearbox/);
  } finally {
    if (runtime) stopSdRuntime(runtime);
    await rm(workspace, { force: true, recursive: true });
  }
});

test('profile runtimes default the session index to the profile session root', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-profile-search-'));
  let runtime: Awaited<ReturnType<typeof createSdRuntime>> | undefined;
  try {
    const profileRoot = join(workspace, 'profiles');
    const profileDir = join(profileRoot, 'reviewer');
    await writeProfile(profileDir);
    const configPath = await writeConfig(workspace, join(workspace, 'sessions'));

    runtime = await createSdRuntime({
      cwd: workspace,
      configPath,
      noBackground: true,
      noSession: true,
      profileName: 'reviewer',
      profileRoot,
    });

    assert.equal(
      resolveSdSessionIndexPath(runtime.config),
      join(profileDir, 'sessions', 'index.sqlite'),
    );
    assert.equal(runtime.sessionIndex?.path, join(profileDir, 'sessions', 'index.sqlite'));
  } finally {
    if (runtime) stopSdRuntime(runtime);
    await rm(workspace, { force: true, recursive: true });
  }
});

test('explicit session index path overrides profile-local defaults', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-search-path-'));
  let runtime: Awaited<ReturnType<typeof createSdRuntime>> | undefined;
  try {
    const profileRoot = join(workspace, 'profiles');
    await writeProfile(join(profileRoot, 'reviewer'));
    const indexPath = join(workspace, 'custom-index.sqlite');
    const configPath = await writeConfig(workspace, join(workspace, 'sessions'), indexPath);

    runtime = await createSdRuntime({
      cwd: workspace,
      configPath,
      noBackground: true,
      noSession: true,
      profileName: 'reviewer',
      profileRoot,
    });

    assert.equal(resolveSdSessionIndexPath(runtime.config), indexPath);
    assert.equal(runtime.sessionIndex?.path, indexPath);
  } finally {
    if (runtime) stopSdRuntime(runtime);
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeConfig(
  workspace: string,
  sessionRoot: string,
  indexPath?: string,
): Promise<string> {
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
      `  root: "${escapeYamlString(sessionRoot)}"`,
      ...(indexPath ? ['  index:', `    path: "${escapeYamlString(indexPath)}"`] : []),
      'skills:',
      '  builtins: false',
      'extensions:',
      '  builtins: false',
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

async function writeProfile(profileDir: string): Promise<void> {
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, 'profile.yaml'), 'name: reviewer\n', 'utf8');
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
