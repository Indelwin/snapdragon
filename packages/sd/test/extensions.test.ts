import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { LlmChatRequest } from '@snapdragon-ai/host';
import { runOneShot } from '../src/repl.ts';
import { createSdRuntime } from '../src/runtime.ts';

test('extensions contribute descriptor-only skill roots without executing code', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-extension-skills-'));
  try {
    await writeExtensionManifest(workspace, 'skill-pack', [
      'id: local/skill-pack',
      'name: Local Skill Pack',
      'contributes:',
      '  skills:',
      '    - skills',
      '',
    ]);
    await writeSkill(
      join(workspace, 'extensions', 'skill-pack', 'skills'),
      'audit',
      'audit',
      'Audit from extension',
    );
    const runtime = await createSdRuntime({
      cwd: workspace,
      configPath: await writeMockConfig(workspace),
      noSession: true,
    });

    assert.ok(runtime.skills.load('audit'));
    assert.equal(runtime.skills.load('audit')?.source, 'extension');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('extensions activate trusted local modules and register toolsets', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-extension-tools-'));
  try {
    await writeExtensionManifest(workspace, 'tools', [
      'id: local/tools',
      'name: Local Tools',
      'main: index.mjs',
      'capabilities: [tools]',
      '',
    ]);
    await writeFile(
      join(workspace, 'extensions', 'tools', 'index.mjs'),
      [
        'export function activate(context) {',
        '  context.registerToolset({',
        "    name: 'extension-demo',",
        "    title: 'Extension demo',",
        "    description: 'Demo extension tools',",
        '    tools: [{',
        "      name: 'extension_ping',",
        "      toolset: 'extension-demo',",
        "      description: 'Ping from extension',",
        "      parameters: { type: 'object', properties: {}, additionalProperties: false },",
        "      async run() { return { content: 'pong from extension' }; }",
        '    }]',
        '  });',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const runtime = await createSdRuntime({
      cwd: workspace,
      configPath: await writeMockConfig(workspace, {
        toolsets: ['file', 'shell', 'repl', 'skill', 'memory', 'extension-demo'],
      }),
      noSession: true,
    });

    const result = await runtime.agent.registry.invoke('extension_ping', {});

    assert.equal(result.content, 'pong from extension');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('extensions can register memory providers and provider factories', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-extension-providers-'));
  try {
    await writeExtensionManifest(workspace, 'providers', [
      'id: local/providers',
      'name: Local Providers',
      'main: index.mjs',
      'capabilities: [memory, providers]',
      '',
    ]);
    await writeFile(
      join(workspace, 'extensions', 'providers', 'index.mjs'),
      [
        'export function activate(context) {',
        "  context.registerMemoryProvider('memory/test', {",
        "    info() { return { id: 'memory/test', title: 'Test Memory', writable: true }; },",
        "    read() { return { entries: [{ id: 'm1', title: 'Preference', content: 'Use extension memory.' }] }; },",
        "    search() { return [{ id: 'm1', title: 'Preference', content: 'Use extension memory.', score: 1 }]; },",
        "    append() { return { success: true, action: 'append', id: 'm2' }; }",
        '  });',
        "  context.registerProvider('provider/test', {",
        "    create(options) { return { model: options.model, handler: async () => ({ content: 'extension provider response' }) }; },",
        "    listModels() { return [{ id: 'extension-model', source: 'static' }]; }",
        '  });',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const runtime = await createSdRuntime({
      cwd: workspace,
      configPath: await writeMockConfig(workspace, {
        defaultProvider: 'ext',
        extraConfig: [
          '  ext:',
          '    kind: extension',
          '    extension: provider/test',
          '    model: extension-model',
          'memory:',
          '  provider: memory/test',
        ],
      }),
      noSession: true,
    });
    let captured: LlmChatRequest | undefined;
    runtime.agent.setProvider(async (request) => {
      captured = request;
      return { content: 'ok' };
    });

    await runOneShot(runtime, 'what should I use?');

    assert.equal(runtime.provider.id, 'ext');
    assert.match(JSON.stringify(captured?.messages), /Use extension memory/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeExtensionManifest(
  workspace: string,
  id: string,
  lines: string[],
): Promise<void> {
  const dir = join(workspace, 'extensions', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'snapdragon.extension.yaml'), lines.join('\n'), 'utf8');
}

async function writeSkill(
  root: string,
  id: string,
  name: string,
  description: string,
): Promise<void> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', 'Body.', ''].join('\n'),
    'utf8',
  );
}

async function writeMockConfig(
  workspace: string,
  options: {
    defaultProvider?: string;
    extraConfig?: string[];
    toolsets?: string[];
  } = {},
): Promise<string> {
  const configPath = join(workspace, 'sd.yaml');
  const toolsets = options.toolsets ?? ['file', 'shell', 'repl', 'skill', 'memory'];
  const hasMemoryConfig = options.extraConfig?.some((line) => line === 'memory:') ?? false;
  const memoryLines = hasMemoryConfig
    ? []
    : ['memory:', `  root: "${escapeYaml(join(workspace, 'memory'))}"`];
  await writeFile(
    configPath,
    [
      'version: 1',
      `default_provider: ${options.defaultProvider ?? 'mock'}`,
      'providers:',
      '  mock:',
      '    kind: mock',
      '    model: mock',
      ...(options.extraConfig ?? []),
      'sessions:',
      `  root: "${escapeYaml(join(workspace, 'sessions'))}"`,
      'skills:',
      `  root: "${escapeYaml(join(workspace, 'skills'))}"`,
      '  builtins: false',
      ...memoryLines,
      'extensions:',
      '  builtins: false',
      '  roots:',
      `    - "${escapeYaml(join(workspace, 'extensions'))}"`,
      'toolsets:',
      '  enabled:',
      ...toolsets.map((toolset) => `    - ${toolset}`),
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"');
}
