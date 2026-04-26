import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from '../src/args.ts';
import { helpText, isDirectEntrypoint } from '../src/cli.ts';
import { DEFAULT_SD_CONFIG_PATH } from '../src/config.ts';

test('sd binary runs through an npm-style symlink', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-bin-'));
  const binPath = join(workspace, 'sd');

  try {
    const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    await symlink(cliPath, binPath);

    assert.equal(isDirectEntrypoint(pathToFileURL(cliPath).href, binPath), true);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('parseArgs handles run, one-shot, setup, and session flags', () => {
  assert.deepEqual(parseArgs(['--provider', 'mock', '--model=mock-1', '--no-session', 'hello']), {
    mode: 'run',
    provider: 'mock',
    model: 'mock-1',
    cwd: process.cwd(),
    configPath: DEFAULT_SD_CONFIG_PATH,
    noSession: true,
    newSession: false,
    prompt: 'hello',
  });

  const setup = parseArgs(['--setup', '--config', './sd.yaml']);
  assert.equal(setup.mode, 'setup');
  assert.match(setup.configPath, /sd\.yaml$/);

  const session = parseArgs(['--session', 'work', '--new-session']);
  assert.equal(session.sessionId, 'work');
  assert.equal(session.newSession, true);
});

test('help text documents the minimal REPL surface', () => {
  assert.match(helpText, /--provider/);
  assert.match(helpText, /--session/);
  assert.match(helpText, /--setup/);
});
