import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import type { LlmChatRequest } from '@snapdragon-ai/host';
import { handleCommand, runOneShot, type SdIo } from '../src/repl.ts';
import { createSdRuntime } from '../src/runtime.ts';

test('sd memory auto-captures triggered preferences and re-injects relevant context', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-memory-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    let captured: LlmChatRequest | undefined;
    runtime.agent.setProvider(async (request) => {
      captured = request;
      return { content: 'noted' };
    });

    await runOneShot(runtime, 'remember to run pack dry before release');
    const memory = await readFile(join(workspace, 'memory', 'MEMORY.md'), 'utf8');
    assert.match(memory, /pack dry/);

    await runOneShot(runtime, 'release checklist?');
    assert.match(JSON.stringify(captured?.messages), /MEMORY.md/);
    assert.match(JSON.stringify(captured?.messages), /pack dry/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('first-party uncle-bob profile template is instantiated with profile-local memory', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-uncle-bob-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const profileRoot = join(workspace, 'profiles');

    const runtime = await createSdRuntime({
      cwd: workspace,
      configPath,
      profileRoot,
      profileName: 'uncle-bob',
      provider: 'mock',
      model: 'mock',
      noSession: true,
    });

    assert.equal(runtime.profile?.name, 'uncle-bob');
    assert.match(
      (await runtime.memory.info()).path ?? '',
      /profiles\/uncle-bob\/memory\/MEMORY.md$/,
    );
    assert.ok(runtime.skills.load('code-review'));
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('sd discovers local extension manifests without loading code', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-extensions-'));
  try {
    const extensionDir = join(workspace, 'extensions', 'local-sandbox');
    await mkdir(extensionDir, { recursive: true });
    await writeFile(
      join(extensionDir, 'snapdragon.extension.yaml'),
      [
        'id: local/sandbox',
        'name: Local Sandbox',
        'description: Local sandbox backend placeholder',
        'capabilities:',
        '  - sandbox',
        '',
      ].join('\n'),
      'utf8',
    );
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });

    assert.deepEqual(
      runtime.extensions.list().map((extension) => extension.id),
      ['local/sandbox'],
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('auto-captured entries are tagged tentative and store the extracted note (not the verbatim message)', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-memory-tentative-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    runtime.agent.setProvider(async () => ({ content: 'noted' }));

    await runOneShot(runtime, 'remember to run pack dry before release');

    const memoryFile = await readFile(join(workspace, 'memory', 'MEMORY.md'), 'utf8');
    assert.match(memoryFile, /tags:.*tentative/);
    // The stored content is the extracted note, not the verbatim user
    // message wrapped in boilerplate.
    assert.doesNotMatch(memoryFile, /User supplied a stable preference/);
    assert.doesNotMatch(memoryFile, /User: remember to run pack dry/);
    assert.match(memoryFile, /run pack dry before release/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('the noisy phrasings that polluted MEMORY.md no longer auto-capture', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-memory-noisy-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    runtime.agent.setProvider(async () => ({ content: 'ok' }));

    // Three real captures from a recent MEMORY.md that ALL fired under v1
    // because of the substring matcher on 'we should' / 'i want'.
    await runOneShot(runtime, 'Honestly, Phase 0 covers most of what we want.');
    await runOneShot(runtime, 'I want you to read this manifesto and apply it.');
    await runOneShot(
      runtime,
      'Ok, I just got an error after your bash tool failed; we should fix it.',
    );

    const memoryPath = join(workspace, 'memory', 'MEMORY.md');
    let memoryFile = '';
    try {
      memoryFile = await readFile(memoryPath, 'utf8');
    } catch {
      // File may not exist if nothing captured — that's the expected case.
    }
    assert.doesNotMatch(memoryFile, /Phase 0 covers/);
    assert.doesNotMatch(memoryFile, /this manifesto/);
    assert.doesNotMatch(memoryFile, /bash tool failed/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('/memory tentative lists, /memory promote strips the tag, /memory forget deletes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-memory-promote-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    runtime.agent.setProvider(async () => ({ content: 'noted' }));

    await runOneShot(runtime, 'remember to run pack dry before release');
    await runOneShot(runtime, 'Always run the linter before pushing.');

    const ioList = memoryIo();
    await handleCommand('/memory tentative', runtime, [], ioList.io);
    const listOutput = ioList.output();
    assert.match(listOutput, /Tentative memory entries \(2\)/);
    const ids = [...listOutput.matchAll(/^\s+([0-9a-z]+)\s/gm)].map((m) => m[1]).filter(Boolean);
    assert.equal(ids.length, 2);

    // Promote the first entry — its 'tentative' tag should disappear.
    const promoteIo = memoryIo();
    await handleCommand(`/memory promote ${ids[0]}`, runtime, [], promoteIo.io);
    assert.match(promoteIo.output(), /Promoted/);
    const fileAfterPromote = await readFile(join(workspace, 'memory', 'MEMORY.md'), 'utf8');
    const firstEntry = fileAfterPromote.split(/\n##\s+/).find((s) => s.includes(ids[0] ?? ''));
    assert.ok(firstEntry, 'promoted entry still present');
    assert.doesNotMatch(firstEntry as string, /tags:[^\n]*tentative/);

    // The second entry is still tentative.
    const stillTentative = fileAfterPromote.split(/\n##\s+/).find((s) => s.includes(ids[1] ?? ''));
    assert.match(stillTentative as string, /tags:[^\n]*tentative/);

    // Forget the second one — it disappears.
    const forgetIo = memoryIo();
    await handleCommand(`/memory forget ${ids[1]}`, runtime, [], forgetIo.io);
    assert.match(forgetIo.output(), /Deleted/);
    const fileAfterForget = await readFile(join(workspace, 'memory', 'MEMORY.md'), 'utf8');
    assert.ok(!fileAfterForget.includes(`id: ${ids[1]}`));
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

function memoryIo(): { io: SdIo; output(): string } {
  let output = '';
  return {
    io: {
      input: Readable.from([]),
      output: new Writable({
        write(chunk, _enc, cb) {
          output += chunk.toString();
          cb();
        },
      }),
      error: new Writable({
        write(_chunk, _enc, cb) {
          cb();
        },
      }),
    },
    output: () => output,
  };
}

async function writeMockConfig(workspace: string): Promise<string> {
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
      `  root: "${escapeYaml(join(workspace, 'sessions'))}"`,
      'skills:',
      `  root: "${escapeYaml(join(workspace, 'skills'))}"`,
      'memory:',
      `  root: "${escapeYaml(join(workspace, 'memory'))}"`,
      'extensions:',
      '  builtins: false',
      '  roots:',
      `    - "${escapeYaml(join(workspace, 'extensions'))}"`,
      'toolsets:',
      '  enabled:',
      '    - file',
      '    - shell',
      '    - repl',
      '    - skill',
      '    - memory',
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"');
}
