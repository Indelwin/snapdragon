import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { defaultSdConfig } from '../src/config.ts';
import { SdProfileStore } from '../src/profile.ts';
import { resolveSdRuntimeConfig } from '../src/profile-runtime.ts';

test('SdProfileStore loads YAML profiles, SOUL.md persona, and sticky default', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-profile-'));
  try {
    const root = join(workspace, 'profiles');
    await writeProfile(root, 'daily', [
      'name: daily',
      'description: Daily driver',
      'model:',
      '  provider: mock',
      '  name: mock-profile',
      '',
    ]);
    await writeFile(join(root, 'daily', 'SOUL.md'), 'Be terse.\n', 'utf8');
    const store = new SdProfileStore({ root });

    store.setActiveName('daily');
    const info = store.load('daily');

    assert.equal(store.activeName(), 'daily');
    assert.equal(info.valid, true);
    assert.equal(info.config?.description, 'Daily driver');
    assert.equal(info.persona, 'Be terse.');
    assert.equal(store.list()[0]?.active, true);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('profile persona_inline wins over persona and profile model overlays base config', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-profile-overlay-'));
  try {
    const root = join(workspace, 'profiles');
    await writeProfile(root, 'focused', [
      'name: focused',
      'persona: persona.md',
      'persona_inline: Inline persona.',
      'model:',
      '  provider: openai-codex',
      '  name: gpt-5.5',
      'agent:',
      '  max_turns: 4',
      'toolsets:',
      '  disabled:',
      '    - shell',
      '',
    ]);
    await writeFile(join(root, 'focused', 'persona.md'), 'File persona.\n', 'utf8');
    const profile = new SdProfileStore({ root }).load('focused');

    const resolved = resolveSdRuntimeConfig(defaultSdConfig(), profile, {
      provider: 'mock',
      model: 'mock-cli',
    });

    assert.equal(profile.persona, 'Inline persona.');
    assert.equal(resolved.config.default_provider, 'mock');
    assert.equal(resolved.config.providers.mock.model, 'mock-cli');
    assert.equal(resolved.config.agent?.max_turns, 4);
    assert.deepEqual(resolved.config.toolsets?.disabled, ['shell']);
    assert.match(resolved.systemPrompt ?? '', /Inline persona/);
    assert.match(resolved.systemPrompt ?? '', /coding agent/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeProfile(root: string, name: string, lines: string[]): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'profile.yaml'), lines.join('\n'), 'utf8');
}
