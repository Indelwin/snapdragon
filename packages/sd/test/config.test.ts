import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  defaultSdConfig,
  loadSdConfig,
  loadSdEnvironment,
  writeDefaultConfig,
  writeEnvTemplate,
} from '../src/config.ts';

test('default config uses Anthropic Opus 4.7 without storing secrets', () => {
  const config = defaultSdConfig();
  assert.equal(config.default_provider, 'anthropic');
  assert.equal(config.providers.anthropic?.api_key_env, 'ANTHROPIC_API_KEY');
  assert.equal(config.providers.anthropic?.model, 'claude-opus-4-7');
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
