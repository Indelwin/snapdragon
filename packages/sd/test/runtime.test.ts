import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { parseArgs } from '../src/args.ts';
import { handleCommand, runOneShot, type SdIo } from '../src/repl.ts';
import { createSdRuntime } from '../src/runtime.ts';

test('createSdRuntime creates a fresh JSONL session and persists prompts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-runtime-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const io = memoryIo();

    await runOneShot(runtime, 'hello', [], io.io);

    assert.ok(runtime.session);
    assert.match(io.output(), /mock response/);
    assert.deepEqual(
      runtime.session.messages().map((message) => message.role),
      ['user', 'assistant'],
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('createSdRuntime can disable sessions', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-runtime-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime(
      parseArgs(['--config', configPath, '--cwd', workspace, '--no-session']),
    );
    assert.equal(runtime.session, undefined);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('REPL tools command shows enabled tools after registry filtering', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-tools-'));
  try {
    const configPath = await writeMockConfig(workspace, ['run_shell']);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const io = memoryIo();

    await handleCommand('/tools', runtime, [], io.io);

    assert.match(io.output(), /read_file/);
    assert.match(io.output(), /repl_eval/);
    assert.doesNotMatch(io.output(), /run_shell/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeMockConfig(workspace: string, deniedTools: string[] = []): Promise<string> {
  const configPath = join(workspace, 'sd.yaml');
  const denied = deniedTools.map((tool) => `    - ${tool}`).join('\n');
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
      `  root: "${join(workspace, 'sessions').replace(/"/g, '\\"')}"`,
      'toolsets:',
      '  enabled:',
      '    - file',
      '    - shell',
      '    - repl',
      '  denied_tools:',
      denied,
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

function memoryIo(): { io: SdIo; output(): string; error(): string } {
  let output = '';
  let error = '';
  return {
    io: {
      input: Readable.from([]),
      output: new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        },
      }),
      error: new Writable({
        write(chunk, _encoding, callback) {
          error += chunk.toString();
          callback();
        },
      }),
    },
    output: () => output,
    error: () => error,
  };
}
