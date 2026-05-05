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
    mode: 'print',
    provider: 'mock',
    model: 'mock-1',
    cwd: process.cwd(),
    configPath: DEFAULT_SD_CONFIG_PATH,
    noSession: true,
    newSession: false,
    resume: false,
    noProfile: false,
    prompt: 'hello',
  });

  const setup = parseArgs(['--setup', '--config', './sd.yaml']);
  assert.equal(setup.mode, 'setup');
  assert.match(setup.configPath, /sd\.yaml$/);

  const session = parseArgs(['--session', 'work', '--new-session']);
  assert.equal(session.sessionId, 'work');
  assert.equal(session.newSession, true);

  const resume = parseArgs(['--resume', '--profile', 'daily']);
  assert.equal(resume.resume, true);
  assert.equal(resume.profileName, 'daily');

  const deleteSession = parseArgs(['--delete-session', 'old']);
  assert.equal(deleteSession.mode, 'delete-session');
  assert.equal(deleteSession.deleteSessionId, 'old');
});

test('parseArgs handles TUI and REPL modes', () => {
  assert.equal(parseArgs([]).mode, 'tui');
  assert.equal(parseArgs(['--repl']).mode, 'repl');
  assert.equal(parseArgs(['repl']).mode, 'repl');
  assert.equal(parseArgs(['--mode', 'print', 'hello']).mode, 'print');
  assert.throws(() => parseArgs(['--mode', 'unknown']), /Invalid --mode/);
});

test('parseArgs handles background and daemon controls', () => {
  const daemon = parseArgs(['daemon', 'status', '--background', 'inline', '--no-background']);
  assert.equal(daemon.mode, 'daemon');
  assert.equal(daemon.daemonAction, 'status');
  assert.equal(daemon.backgroundMode, 'inline');
  assert.equal(daemon.noBackground, true);
  const gateway = parseArgs(['gateway', 'services', 'run', 'memory-worker']);
  assert.equal(gateway.mode, 'gateway');
  assert.deepEqual(gateway.gatewayArgs, ['services', 'run', 'memory-worker']);
  assert.throws(() => parseArgs(['--background', 'wat']), /Invalid --background/);
});

test('help text documents the minimal REPL surface', () => {
  assert.match(helpText, /--provider/);
  assert.match(helpText, /--repl/);
  assert.match(helpText, /--mode/);
  assert.match(helpText, /--session/);
  assert.match(helpText, /--resume/);
  assert.match(helpText, /--profile/);
  assert.match(helpText, /--list-sessions/);
  assert.match(helpText, /--setup/);
  assert.match(helpText, /daemon/);
  assert.match(helpText, /gateway/);
  assert.match(helpText, /--background/);
});
