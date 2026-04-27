import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import type { LlmChatRequest } from '@snapdragon-ai/host';
import { handleCommand, runCommandPrompt, type SdIo } from '../src/repl.ts';
import { createSdRuntime } from '../src/runtime.ts';
import { resolveSdSkillRoots } from '../src/skills.ts';

test('sd skill roots are unprofiled by default and profile-first when active', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-skills-roots-'));
  try {
    const globalRoot = join(workspace, 'global-skills');
    const sharedRoot = join(workspace, 'shared-skills');
    const profileRoot = join(workspace, 'profiles');
    await writeSkill(globalRoot, 'global-only', 'global-only', 'Global only', 'Global body.');
    await writeSkill(sharedRoot, 'shared-only', 'shared-only', 'Shared only', 'Shared body.');
    await writeProfile(profileRoot, 'daily', [
      'name: daily',
      'skills:',
      '  shared_roots:',
      `    - "${escapeYaml(sharedRoot)}"`,
      '',
    ]);
    await writeSkill(
      join(profileRoot, 'daily', 'skills'),
      'profile-only',
      'profile-only',
      'Profile only',
      'Profile body.',
    );
    const configPath = await writeMockConfig(workspace, globalRoot);

    const plain = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
    const profiled = await createSdRuntime({
      cwd: workspace,
      configPath,
      profileRoot,
      profileName: 'daily',
      noSession: true,
    });

    assert.deepEqual(
      plain.skills.list().map((skill) => skill.id),
      ['global-only'],
    );
    assert.deepEqual(
      profiled.skills.list().map((skill) => skill.id),
      ['profile-only', 'shared-only'],
    );
    assert.deepEqual(
      resolveSdSkillRoots(profiled.config, profiled.profile).map((root) => root.source),
      ['profile', 'shared'],
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('skill commands inject full skill body for one run while persisting visible command only', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-skill-invoke-'));
  try {
    const skillRoot = join(workspace, 'skills');
    await writeSkill(
      skillRoot,
      'code-review',
      'code-review',
      'Review code',
      'SPECIAL_SKILL_BODY\n\nUse strict review rules.',
    );
    const configPath = await writeMockConfig(workspace, skillRoot);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, sessionId: 'alpha' });
    let captured: LlmChatRequest | undefined;
    runtime.agent.setProvider(async (request) => {
      captured = request;
      return { content: 'reviewed' };
    });
    const io = memoryIo();

    const command = await handleCommand('/code-review inspect this diff', runtime, [], io.io);
    assert.ok(command.prompt);
    await runCommandPrompt(runtime, command.prompt, io.io);

    assert.match(JSON.stringify(captured?.messages), /SPECIAL_SKILL_BODY/);
    assert.deepEqual(
      runtime.session?.messages().map((message) => message.content),
      ['/code-review inspect this diff', 'reviewed'],
    );
    assert.doesNotMatch(JSON.stringify(runtime.agent.messages), /SPECIAL_SKILL_BODY/);
    assert.match(JSON.stringify(runtime.session?.records()), /skill_invocation/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('skill tool authoring writes only guarded supporting paths', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-skill-authoring-'));
  try {
    const skillRoot = join(workspace, 'skills');
    await writeSkill(skillRoot, 'code-review', 'code-review', 'Review code', 'Review body.');
    const configPath = await writeMockConfig(workspace, skillRoot);
    const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });

    const denied = await runtime.agent.registry.invoke('skill_manage', {
      action: 'write_file',
      id: 'code-review',
      file_path: '../escape.md',
      file_content: 'no',
    });
    const allowed = await runtime.agent.registry.invoke('skill_manage', {
      action: 'write_file',
      id: 'code-review',
      file_path: 'scripts/check.sh',
      file_content: 'echo ok\n',
    });

    assert.equal(denied.isError, true);
    assert.equal(allowed.isError, false);
    assert.match(
      runtime.skills.load('code-review')?.linkedFiles?.scripts?.join('\n') ?? '',
      /check.sh/,
    );
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeMockConfig(workspace: string, skillRoot: string): Promise<string> {
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
      `  root: "${escapeYaml(skillRoot)}"`,
      '  builtins: false',
      'toolsets:',
      '  enabled:',
      '    - file',
      '    - shell',
      '    - repl',
      '    - skill',
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

async function writeProfile(root: string, name: string, lines: string[]): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'profile.yaml'), lines.join('\n'), 'utf8');
}

async function writeSkill(
  root: string,
  id: string,
  name: string,
  description: string,
  body: string,
): Promise<void> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', body, ''].join('\n'),
    'utf8',
  );
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"');
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
