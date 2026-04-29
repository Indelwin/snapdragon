import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEFAULT_SD_CONFIG_PATH,
  defaultSdConfig,
  loadSdConfig,
  loadSdEnvironment,
  writeDefaultConfig,
  writeEnvTemplate,
} from '../src/config.ts';
import { configPathForLoad } from '../src/config-path.ts';

test('default config uses Anthropic Opus 4.7 without storing secrets', () => {
  const config = defaultSdConfig();
  assert.equal(config.default_provider, 'anthropic');
  assert.equal(config.providers.anthropic?.api_key_env, 'ANTHROPIC_API_KEY');
  assert.equal(config.providers.anthropic?.model, 'claude-opus-4-7');
  assert.deepEqual(config.sessions?.title, {
    enabled: true,
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 48,
  });
  assert.equal(config.agent?.max_tokens, 32_000);
  assert.deepEqual(config.agent?.context, {
    enabled: true,
    fresh_tail_count: 32,
    max_request_tokens: 400_000,
    chunk_target_tokens: 8_000,
    summary_target_tokens: 1_500,
  });
  assert.deepEqual(config.agent?.reasoning, {
    enabled: true,
    effort: 'medium',
  });
  assert.equal(JSON.stringify(config).includes('sk-ant-'), false);
});

test('loadSdConfig merges YAML with defaults', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-config-'));
  const configPath = join(workspace, 'config.yaml');
  try {
    await writeFile(
      configPath,
      [
        'version: 1',
        'default_provider: mock',
        'providers:',
        '  mock:',
        '    kind: mock',
        '    model: local-mock',
        '',
      ].join('\n'),
      'utf8',
    );

    const config = await loadSdConfig(configPath);
    assert.equal(config.default_provider, 'mock');
    assert.equal(config.providers.mock?.model, 'local-mock');
    assert.equal(config.providers.anthropic?.model, 'claude-opus-4-7');
    assert.equal(config.sessions?.title?.provider, 'anthropic');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('loadSdConfig falls back to legacy root config when default path is absent', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-legacy-config-'));
  const configPath = join(workspace, 'sd/config.yaml');
  const legacyPath = join(workspace, 'config.yaml');
  try {
    await writeFile(
      legacyPath,
      [
        'version: 1',
        'default_provider: mock',
        'providers:',
        '  mock:',
        '    model: old-root',
        '',
      ].join('\n'),
      'utf8',
    );

    assert.equal(configPathForLoad(configPath, legacyPath, configPath), legacyPath);
    assert.equal(configPathForLoad(legacyPath, configPath, DEFAULT_SD_CONFIG_PATH), legacyPath);

    const config = await loadSdConfig(legacyPath, configPath);
    assert.equal(config.default_provider, 'mock');
    assert.equal(config.providers.mock?.model, 'old-root');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('loadSdConfig deep merges session title settings', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-title-config-'));
  const configPath = join(workspace, 'config.yaml');
  try {
    await writeFile(
      configPath,
      [
        'version: 1',
        'sessions:',
        '  title:',
        '    provider: mock',
        '    model: mock-title',
        '',
      ].join('\n'),
      'utf8',
    );

    const config = await loadSdConfig(configPath);
    assert.equal(config.sessions?.title?.enabled, true);
    assert.equal(config.sessions?.title?.provider, 'mock');
    assert.equal(config.sessions?.title?.model, 'mock-title');
    assert.equal(config.sessions?.title?.max_tokens, 48);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('loadSdConfig deep merges agent context settings', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-context-config-'));
  const configPath = join(workspace, 'config.yaml');
  try {
    await writeFile(
      configPath,
      ['version: 1', 'agent:', '  context:', '    max_request_tokens: 64000', ''].join('\n'),
      'utf8',
    );

    const config = await loadSdConfig(configPath);
    assert.equal(config.agent?.context?.enabled, true);
    assert.equal(config.agent?.context?.fresh_tail_count, 32);
    assert.equal(config.agent?.context?.max_request_tokens, 64_000);
    assert.equal(config.agent?.context?.chunk_target_tokens, 8_000);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('loadSdConfig honours user reasoning override and disable', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-reasoning-config-'));
  const configPath = join(workspace, 'config.yaml');
  try {
    await writeFile(
      configPath,
      ['version: 1', 'agent:', '  reasoning:', '    effort: high', ''].join('\n'),
      'utf8',
    );
    const overridden = await loadSdConfig(configPath);
    assert.equal(overridden.agent?.reasoning?.enabled, true);
    assert.equal(overridden.agent?.reasoning?.effort, 'high');

    await writeFile(
      configPath,
      ['version: 1', 'agent:', '  reasoning:', '    enabled: false', ''].join('\n'),
      'utf8',
    );
    const disabled = await loadSdConfig(configPath);
    assert.equal(disabled.agent?.reasoning?.enabled, false);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('setup writers create config and dotenv template without overwriting', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-setup-'));
  const configPath = join(workspace, 'config.yaml');
  const envPath = join(workspace, '.env');
  try {
    assert.equal(await writeDefaultConfig(configPath), true);
    assert.equal(await writeDefaultConfig(configPath), false);
    assert.equal(await writeEnvTemplate(envPath), true);
    assert.equal(await writeEnvTemplate(envPath), false);

    const config = await readFile(configPath, 'utf8');
    const env = await readFile(envPath, 'utf8');
    assert.match(config, /ANTHROPIC_API_KEY/);
    assert.doesNotMatch(config, /sk-ant-/);
    assert.match(env, /OPENAI_API_KEY/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('loadSdEnvironment loads dotenv values without overriding exported env', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-env-'));
  const envPath = join(workspace, '.env');
  try {
    await writeFile(envPath, 'ANTHROPIC_API_KEY=file-value\nOPENAI_API_KEY=file-openai\n');
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'exported-value' };
    const parsed = await loadSdEnvironment(envPath, env);
    assert.equal(parsed.ANTHROPIC_API_KEY, 'file-value');
    assert.equal(env.ANTHROPIC_API_KEY, 'exported-value');
    assert.equal(env.OPENAI_API_KEY, 'file-openai');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});
