import assert from 'node:assert/strict';
import test from 'node:test';
import { daemonArgs } from '../src/daemon-spawn.ts';

test('daemonArgs forwards runtime options to daemon run', () => {
  assert.deepEqual(
    daemonArgs(
      {
        configPath: '/tmp/sd.yaml',
        cwd: '/tmp/workspace',
        model: 'gpt-5.5',
        noProfile: true,
        profileName: 'uncle-bob',
        provider: 'openai-codex',
      },
      '/usr/local/bin/sd',
    ),
    [
      '/usr/local/bin/sd',
      'daemon',
      'run',
      '--config',
      '/tmp/sd.yaml',
      '--cwd',
      '/tmp/workspace',
      '--profile',
      'uncle-bob',
      '--no-profile',
      '--provider',
      'openai-codex',
      '--model',
      'gpt-5.5',
    ],
  );
});

test('daemonArgs keeps the minimal daemon run command when no optional flags are set', () => {
  assert.deepEqual(daemonArgs({ cwd: '/tmp/workspace' }, 'sd'), [
    'sd',
    'daemon',
    'run',
    '--cwd',
    '/tmp/workspace',
  ]);
});
