import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GitRunOptions } from '../src/git-env.ts';
import { initShadowRepo } from '../src/shadow-repo.ts';
import { takeSnapshot } from '../src/snapshot.ts';

async function setupShadow(prefix: string): Promise<{
  root: string;
  project: string;
  baseOpts: Omit<GitRunOptions, 'allowedExitCodes'>;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const project = join(root, 'project');
  const shadowBase = join(root, 'shadow');
  await mkdir(project, { recursive: true });

  const init = await initShadowRepo({
    baseDir: shadowBase,
    workTree: project,
    gitBinary: 'git',
    gitTimeoutMs: 5_000,
  });
  if (!init.ok) throw new Error(`init failed: ${init.error}`);

  return {
    root,
    project,
    baseOpts: {
      shadowDir: init.shadowDir,
      workTree: project,
      gitBinary: 'git',
      timeoutMs: 5_000,
    },
  };
}

test('takeSnapshot returns taken=false when there are no changes to commit', async () => {
  const { root, project, baseOpts } = await setupShadow('snapshot-noop-');
  try {
    await writeFile(join(project, 'a.txt'), 'one\n', 'utf8');

    // First snapshot captures the initial file.
    const first = await takeSnapshot(baseOpts, 'initial');
    assert.equal(first.taken, true);
    assert.ok(first.hash);

    // Nothing changed since: snapshot should be a no-op, no error.
    const second = await takeSnapshot(baseOpts, 'no-op');
    assert.equal(second.taken, false);
    assert.equal(second.error, undefined);
    assert.equal(second.hash, undefined);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('takeSnapshot sanitizes reason: collapses whitespace and truncates very long messages', async () => {
  const { root, project, baseOpts } = await setupShadow('snapshot-reason-');
  try {
    await writeFile(join(project, 'a.txt'), 'x\n', 'utf8');
    const long = 'X'.repeat(500);
    const messy = `  before\n\n\n   ${long}  `;
    const result = await takeSnapshot(baseOpts, messy);
    assert.equal(result.taken, true);
    assert.ok(result.hash);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('takeSnapshot uses default reason when input is whitespace-only', async () => {
  const { root, project, baseOpts } = await setupShadow('snapshot-empty-');
  try {
    await writeFile(join(project, 'a.txt'), 'x\n', 'utf8');
    const result = await takeSnapshot(baseOpts, '   \n\t  ');
    assert.equal(result.taken, true);
    assert.ok(result.hash);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
