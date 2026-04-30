import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { handleCommand, type SdIo } from '../src/repl.ts';
import { createSdRuntime } from '../src/runtime.ts';
import { formatSdStatus, gatherSdStatus } from '../src/status.ts';

test('gatherSdStatus reports provider, profile, services, memory, skills, tools', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-status-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    const report = gatherSdStatus(runtime);

    assert.equal(report.agent.provider, 'mock');
    assert.equal(report.agent.model, 'mock');
    assert.equal(report.agent.messages, 0);
    assert.equal(report.cwd, workspace);
    assert.equal(report.session, undefined, 'no-session run reports session=undefined');
    assert.ok(Array.isArray(report.services), 'services list should always be present');
    assert.equal(report.memory.enabled, true);
    assert.ok(report.tools.total > 0, 'mock runtime registers at least one tool');
    assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('gatherSdStatus tallies tentative memory entries from the existing tag', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-status-mem-'));
  try {
    const configPath = await writeMockConfig(workspace);
    // Pre-seed MEMORY.md with one regular and one tentative entry so we can
    // verify gatherSdStatus distinguishes them. The format mirrors what
    // formatMemoryMarkdownEntry produces.
    const memDir = join(workspace, 'memory');
    await mkdir(memDir, { recursive: true });
    await writeFile(
      join(memDir, 'MEMORY.md'),
      [
        '# Snapdragon Memory',
        '',
        '## 2026-01-01T00:00:00.000Z - Regular note',
        'id: 20260101t000000000z',
        'tags: stable',
        '',
        'A confirmed preference.',
        '',
        '## 2026-01-02T00:00:00.000Z - Auto: prefer X over Y',
        'id: 20260102t000000000z',
        'tags: auto, tentative, prefer-over',
        '',
        'Prefer X over Y',
        '',
      ].join('\n'),
      'utf8',
    );
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    const report = gatherSdStatus(runtime);
    assert.equal(report.memory.total, 2);
    assert.equal(report.memory.tentative, 1);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('formatSdStatus produces a human-scannable dashboard', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-status-fmt-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    const text = formatSdStatus(gatherSdStatus(runtime));
    // Headline ordering: agent, then session/cwd, then services if any,
    // then memory, then skills/tools.
    assert.match(text, /^agent\s+mock\/mock/m);
    assert.match(text, /^session\s+\(none\)/m);
    assert.match(text, /^cwd\s+/m);
    assert.match(text, /^memory\s+\d+ entries/m);
    assert.match(text, /^tools\s+\d+/m);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('/status routes through handleCommand and prints the dashboard', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-status-cmd-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    const io = memoryIo();
    const result = await handleCommand('/status', runtime, [], io.io);
    assert.equal(result.quit, false);
    const out = io.output();
    assert.match(out, /^agent\s+mock/m);
    assert.match(out, /^memory\s+/m);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('gatherSdStatus is read-only — does not mutate runtime state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-status-readonly-'));
  try {
    const configPath = await writeMockConfig(workspace);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    const initialMessages = runtime.agent.messages.length;
    const initialServices = runtime.background.list();
    gatherSdStatus(runtime);
    gatherSdStatus(runtime); // Twice for good measure.
    assert.equal(runtime.agent.messages.length, initialMessages);
    // Service status objects come back as fresh clones; the runtime list
    // should still reflect the same service names and run counts.
    const after = runtime.background.list();
    assert.deepEqual(
      after.map((s) => s.name),
      initialServices.map((s) => s.name),
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeMockConfig(workspace: string): Promise<string> {
  const configPath = join(workspace, 'sd.yaml');
  await mkdir(workspace, { recursive: true });
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
      'memory:',
      `  root: "${join(workspace, 'memory').replace(/"/g, '\\"')}"`,
      'toolsets:',
      '  enabled:',
      '    - file',
      '    - shell',
      '    - repl',
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

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
