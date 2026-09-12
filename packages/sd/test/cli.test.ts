import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from '../src/args.ts';
import { applyRestartState, helpText, isDirectEntrypoint } from '../src/cli.ts';
import { spawnSupervisedChild } from '../src/cli-child-process.ts';
import { attachSupervisedChildShutdown } from '../src/cli-child-shutdown.ts';
import {
  SD_RESTART_EXIT_CODE,
  SD_RESTART_REQUEST_PATH_ENV,
  SD_RESTART_STATE_ENV,
  superviseSdCli,
} from '../src/cli-supervisor.ts';
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

test('parseArgs handles doctor JSON and opt-in diagnostics', () => {
  const doctor = parseArgs(['doctor', '--json']);
  assert.equal(doctor.mode, 'doctor');
  assert.equal(doctor.json, true);
  const runtime = parseArgs(['--diagnostics', '--print', 'hello']);
  assert.equal(runtime.mode, 'print');
  assert.equal(runtime.diagnostics, true);
  assert.equal(runtime.prompt, 'hello');
  assert.throws(() => parseArgs(['--json']), /Unknown option/);
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
  const gatewayFlags = parseArgs([
    'gateway',
    'sandboxes',
    'lease',
    '.',
    '--id',
    'work',
    '--ref',
    '../reference',
    '--config',
    './sd.yaml',
  ]);
  assert.deepEqual(gatewayFlags.gatewayArgs, [
    'sandboxes',
    'lease',
    '.',
    '--id',
    'work',
    '--ref',
    '../reference',
  ]);
  assert.match(gatewayFlags.configPath, /sd\.yaml$/);
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
  assert.match(helpText, /doctor/);
  assert.match(helpText, /--diagnostics/);
});

test('restart state explicitly restores session, provider, profile, and no-session choices', () => {
  const resumed = parseArgs(['--no-session', '--no-profile']);
  applyRestartState(resumed, {
    sessionId: 'session-a',
    noSession: false,
    provider: 'mock-two',
    model: 'model-two',
    profileName: 'daily',
    noProfile: false,
  });
  assert.equal(resumed.sessionId, 'session-a');
  assert.equal(resumed.resume, true);
  assert.equal(resumed.noSession, false);
  assert.equal(resumed.provider, 'mock-two');
  assert.equal(resumed.model, 'model-two');
  assert.equal(resumed.profileName, 'daily');
  assert.equal(resumed.noProfile, false);

  applyRestartState(resumed, {
    noSession: true,
    provider: 'mock-two',
    model: 'model-two',
    noProfile: true,
  });
  assert.equal(resumed.sessionId, undefined);
  assert.equal(resumed.resume, false);
  assert.equal(resumed.noSession, true);
  assert.equal(resumed.profileName, undefined);
  assert.equal(resumed.noProfile, true);
});

test('CLI supervisor restarts only after a child emits structured state', async () => {
  const childStates: Array<string | undefined> = [];
  const code = await superviseSdCli(['--repl'], {
    entrypoint: '/unused/sd.js',
    env: {},
    runChild: async (_argv, env) => {
      childStates.push(env[SD_RESTART_STATE_ENV]);
      if (childStates.length > 1) return 0;
      const path = env[SD_RESTART_REQUEST_PATH_ENV];
      assert.ok(path);
      await writeFile(
        path,
        JSON.stringify({
          kind: 'restart',
          reason: 'executable_reload',
          state: {
            sessionId: 'session-a',
            noSession: false,
            provider: 'mock',
            model: 'model-a',
            profileName: 'daily',
            noProfile: false,
            draft: 'unfinished input',
          },
        }),
        'utf8',
      );
      return SD_RESTART_EXIT_CODE;
    },
  });

  assert.equal(code, 0);
  assert.equal(childStates[0], undefined);
  assert.deepEqual(JSON.parse(childStates[1] ?? ''), {
    sessionId: 'session-a',
    noSession: false,
    provider: 'mock',
    model: 'model-a',
    profileName: 'daily',
    noProfile: false,
    draft: 'unfinished input',
  });
});

test('supervised children inherit execArgv without double-forwarding group signals', async () => {
  const source = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & { kill(signal: NodeJS.Signals): boolean };
  const killed: NodeJS.Signals[] = [];
  child.kill = (signal) => {
    killed.push(signal);
    return true;
  };
  let spawned: { command: string; args: string[] } | undefined;
  const runChild = spawnSupervisedChild('/app/sd.js', {
    execArgv: ['--trace-warnings'],
    execPath: '/runtime/node',
    signalSource: source,
    signalGraceMs: 10,
    signalKillMs: 20,
    spawnProcess: (command, args) => {
      spawned = { command, args };
      return child;
    },
  });

  const completed = runChild(['--repl'], {});
  source.emit('SIGINT');
  queueMicrotask(() => child.emit('close', null, 'SIGINT'));

  assert.equal(await completed, 130);
  assert.deepEqual(spawned, {
    command: '/runtime/node',
    args: ['--trace-warnings', '/app/sd.js', '--repl'],
  });
  assert.deepEqual(killed, []);
  assert.equal(source.listenerCount('SIGINT'), 0);
  assert.equal(source.listenerCount('SIGTERM'), 0);
  assert.equal(source.listenerCount('SIGHUP'), 0);
});

test('supervised child signals abort graceful work and restore process listeners', () => {
  const source = new EventEmitter();
  const shutdown = attachSupervisedChildShutdown(source);

  source.emit('SIGTERM');
  source.emit('SIGINT');

  assert.equal(shutdown.signal.aborted, true);
  assert.equal((shutdown.signal.reason as Error).name, 'AbortError');
  assert.match((shutdown.signal.reason as Error).message, /SIGTERM/);
  assert.equal(shutdown.exitCode(), 143);

  shutdown.dispose();
  assert.equal(source.listenerCount('SIGINT'), 0);
  assert.equal(source.listenerCount('SIGTERM'), 0);
  assert.equal(source.listenerCount('SIGHUP'), 0);
});

test('supervised children escalate targeted parent signals and bound ignored termination', async () => {
  const source = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & { kill(signal: NodeJS.Signals): boolean };
  const killed: NodeJS.Signals[] = [];
  child.kill = (signal) => {
    killed.push(signal);
    if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, signal));
    else throw new Error('signal raced or was ignored');
    return true;
  };
  const runChild = spawnSupervisedChild('/app/sd.js', {
    signalSource: source,
    signalGraceMs: 1,
    signalKillMs: 10,
    spawnProcess: () => child,
  });

  const completed = runChild([], {});
  source.emit('SIGINT');

  assert.equal(await completed, 137);
  assert.deepEqual(killed, ['SIGTERM', 'SIGKILL']);
  assert.equal(source.listenerCount('SIGINT'), 0);
  assert.equal(source.listenerCount('SIGTERM'), 0);
  assert.equal(source.listenerCount('SIGHUP'), 0);
});

test('supervised children surface failed force-kill instead of waiting forever', async () => {
  const source = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & { kill(signal: NodeJS.Signals): boolean };
  child.kill = (signal) => {
    if (signal === 'SIGKILL') throw new Error('permission denied');
    return false;
  };
  const runChild = spawnSupervisedChild('/app/sd.js', {
    signalSource: source,
    signalGraceMs: 1,
    signalKillMs: 5,
    spawnProcess: () => child,
  });

  const completed = runChild([], {});
  source.emit('SIGTERM');

  await assert.rejects(completed, /Failed to signal child with SIGKILL/);
  assert.equal(source.listenerCount('SIGINT'), 0);
  assert.equal(source.listenerCount('SIGTERM'), 0);
  assert.equal(source.listenerCount('SIGHUP'), 0);
});
