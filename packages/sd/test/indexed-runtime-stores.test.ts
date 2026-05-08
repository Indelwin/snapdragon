import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs } from '../src/args.ts';
import { reloadSdRuntime } from '../src/reload.ts';
import { createSdRuntime } from '../src/runtime.ts';
import { SdSearchIndex } from '../src/search-index.ts';

const MEMORY_ID = '20260101000000';
const MEMORY_TITLE = 'Release ritual';
const MEMORY_CONTENT = 'run indexed pack dry before shipping';
const SKILL_ID = 'indexed-release-helper';
const SKILL_NAME = 'Indexed Release Helper';
const SKILL_BODY = 'Use the indexed-only zephyr checksum ritual before release.';

test('runtime memory search routes through the attached search index', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-indexed-memory-'));
  try {
    const configPath = await writeIndexedStoreConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));

    const results = runtime.memory.search({ query: 'indexed pack', limit: 5 });

    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, MEMORY_ID);
    assert.equal(results[0]?.title, MEMORY_TITLE);
    assert.match(results[0]?.content ?? '', /indexed pack dry/);

    const index = SdSearchIndex.open(indexPath(workspace));
    try {
      assert.equal(index.count('memory'), 1);
      assert.equal(index.get('memory', MEMORY_ID)?.accessCount, 1);
    } finally {
      index.close();
    }
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('runtime skill search routes through the attached search index', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-indexed-skills-'));
  try {
    const configPath = await writeIndexedStoreConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));

    const results = runtime.skills.search('zephyr checksum', 5);

    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, SKILL_ID);
    assert.equal(results[0]?.name, SKILL_NAME);

    const index = SdSearchIndex.open(indexPath(workspace));
    try {
      assert.equal(index.count('skill'), 1);
      assert.equal(index.get('skill', SKILL_ID)?.accessCount, 1);
    } finally {
      index.close();
    }
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('runtime rebuild reattaches the search index to fresh memory and skill stores', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-indexed-rebuild-'));
  try {
    const configPath = await writeIndexedStoreConfig(workspace);
    const runtime = await createSdRuntime(parseArgs(['--config', configPath, '--cwd', workspace]));
    const initialMemory = runtime.memory;
    const initialSkills = runtime.skills;

    assert.equal(runtime.memory.search({ query: 'indexed pack', limit: 5 })[0]?.id, MEMORY_ID);
    assert.equal(runtime.skills.search('zephyr checksum', 5)[0]?.id, SKILL_ID);

    await reloadSdRuntime(runtime);

    assert.notStrictEqual(runtime.memory, initialMemory, 'rebuild should replace the memory store');
    assert.notStrictEqual(runtime.skills, initialSkills, 'rebuild should replace the skill store');
    assert.equal(runtime.memory.search({ query: 'indexed pack', limit: 5 })[0]?.id, MEMORY_ID);
    assert.equal(runtime.skills.search('zephyr checksum', 5)[0]?.id, SKILL_ID);

    const index = SdSearchIndex.open(indexPath(workspace));
    try {
      assert.equal(index.get('memory', MEMORY_ID)?.accessCount, 2);
      assert.equal(index.get('skill', SKILL_ID)?.accessCount, 2);
    } finally {
      index.close();
    }
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

async function writeIndexedStoreConfig(workspace: string): Promise<string> {
  const memoryRoot = join(workspace, 'memory');
  const skillRoot = join(workspace, 'skills');
  await mkdir(memoryRoot, { recursive: true });
  await mkdir(join(skillRoot, SKILL_ID), { recursive: true });
  await writeFile(join(memoryRoot, 'MEMORY.md'), memoryMarkdown(), 'utf8');
  await writeFile(join(skillRoot, SKILL_ID, 'SKILL.md'), skillMarkdown(), 'utf8');

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
      '  builtins: false',
      `  root: "${escapeYaml(skillRoot)}"`,
      'memory:',
      `  root: "${escapeYaml(memoryRoot)}"`,
      'extensions:',
      '  builtins: false',
      '  roots:',
      `    - "${escapeYaml(join(workspace, 'extensions'))}"`,
      'toolsets:',
      '  enabled:',
      '    - skill',
      '    - memory',
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

function memoryMarkdown(): string {
  return [
    '# Snapdragon Memory',
    '',
    `## 2026-01-01T00:00:00.000Z - ${MEMORY_TITLE}`,
    `id: ${MEMORY_ID}`,
    'source: test',
    'tags: release,indexed',
    '',
    MEMORY_CONTENT,
    '',
  ].join('\n');
}

function skillMarkdown(): string {
  return [
    '---',
    `name: ${SKILL_NAME}`,
    'description: Release helper visible only through indexed body search.',
    'tags: [release]',
    '---',
    SKILL_BODY,
    '',
  ].join('\n');
}

function indexPath(workspace: string): string {
  return join(workspace, 'memory', 'MEMORY.index.sqlite');
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"');
}
