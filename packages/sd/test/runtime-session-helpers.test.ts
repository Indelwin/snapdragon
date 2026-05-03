import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SessionStore } from '@snapdragon-ai/session';
import { defaultSdConfig, type SdConfig } from '../src/config.ts';
import { sessionModelFor } from '../src/runtime-session-provider-model.ts';
import { selectRuntimeSession } from '../src/runtime-session-select.ts';

function configWithProvider(model?: string, models?: string[]): SdConfig {
  return {
    ...defaultSdConfig(),
    providers: { mock: { kind: 'mock', model, models } },
  };
}

test('sessionModelFor returns undefined when model or provider is missing', () => {
  const config = configWithProvider('m1');
  assert.equal(sessionModelFor(undefined, 'mock', 'm1', false, config, []), undefined);
  assert.equal(sessionModelFor('mock', 'mock', undefined, false, config, []), undefined);
});

test('sessionModelFor drops session model when provider was explicitly switched', () => {
  const config = configWithProvider('m1');
  const warnings: string[] = [];
  const result = sessionModelFor('other', 'mock', 'm1', true, config, warnings);
  assert.equal(result, undefined);
  assert.deepEqual(warnings, []);
});

test('sessionModelFor returns model when configured for the provider', () => {
  const config = configWithProvider('m1', ['m1', 'm2']);
  const warnings: string[] = [];
  assert.equal(sessionModelFor('mock', 'mock', 'm1', false, config, warnings), 'm1');
  assert.deepEqual(warnings, []);
});

test('sessionModelFor warns and returns undefined when model is no longer configured', () => {
  const config = configWithProvider('m1', ['m1']);
  const warnings: string[] = [];
  const result = sessionModelFor('mock', 'mock', 'gone', false, config, warnings);
  assert.equal(result, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /no longer configured/);
});

async function tempConfig(): Promise<{ workspace: string; config: SdConfig }> {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-select-'));
  const config = {
    ...defaultSdConfig(),
    sessions: { enabled: true, root: join(workspace, 'sessions') },
  } as SdConfig;
  return { workspace, config };
}

test('selectRuntimeSession returns no session when noSession=true', async () => {
  const { workspace, config } = await tempConfig();
  try {
    const result = selectRuntimeSession({ cwd: workspace, noSession: true }, config);
    assert.equal(result.session, undefined);
    assert.equal(result.createAfterProvider, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('selectRuntimeSession defers creation when newSession=true', async () => {
  const { workspace, config } = await tempConfig();
  try {
    const result = selectRuntimeSession({ cwd: workspace, newSession: true }, config);
    assert.equal(result.session, undefined);
    assert.equal(result.createAfterProvider, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('selectRuntimeSession opens an existing sessionId', async () => {
  const { workspace, config } = await tempConfig();
  try {
    const store = new SessionStore({ root: join(workspace, 'sessions') });
    store.create('id-explicit', {
      app: 'sd',
      provider: 'mock',
      model: 'mock',
      cwd: workspace,
    });
    const result = selectRuntimeSession({ cwd: workspace, sessionId: 'id-explicit' }, config);
    assert.ok(result.session);
    assert.equal(result.createAfterProvider, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('selectRuntimeSession resumes the latest session when --resume is set', async () => {
  const { workspace, config } = await tempConfig();
  try {
    const store = new SessionStore({ root: join(workspace, 'sessions') });
    store.create('id-a', { app: 'sd', provider: 'mock', model: 'mock', cwd: workspace });
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.create('id-b', { app: 'sd', provider: 'mock', model: 'mock', cwd: workspace });
    const result = selectRuntimeSession({ cwd: workspace, resume: true }, config);
    assert.ok(result.session);
    assert.equal(result.createAfterProvider, false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('selectRuntimeSession resume with explicit sessionId opens that one', async () => {
  const { workspace, config } = await tempConfig();
  try {
    const store = new SessionStore({ root: join(workspace, 'sessions') });
    store.create('id-target', {
      app: 'sd',
      provider: 'mock',
      model: 'mock',
      cwd: workspace,
    });
    const result = selectRuntimeSession(
      { cwd: workspace, resume: true, sessionId: 'id-target' },
      config,
    );
    assert.ok(result.session);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('selectRuntimeSession resume throws when there is nothing to resume', async () => {
  const { workspace, config } = await tempConfig();
  try {
    assert.throws(
      () => selectRuntimeSession({ cwd: workspace, resume: true }, config),
      /No sessions found to resume/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('selectRuntimeSession falls back to creating a new session when sessionId does not exist', async () => {
  const { workspace, config } = await tempConfig();
  try {
    const result = selectRuntimeSession({ cwd: workspace, sessionId: 'does-not-exist' }, config);
    assert.equal(result.session, undefined);
    assert.equal(result.createAfterProvider, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

// Suppress unused import warning if writeFile isn't used elsewhere.
void writeFile;
