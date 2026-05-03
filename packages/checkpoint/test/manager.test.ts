import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CheckpointManager } from '../src/manager.ts';

async function makeWorkspace(prefix: string): Promise<{ root: string; baseDir: string }> {
  const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
  await mkdir(join(root, 'project'), { recursive: true });
  // Make the project a recognisable root for getWorkingDirForPath users.
  await writeFile(join(root, 'project', 'package.json'), '{}', 'utf8');
  return { root, baseDir: join(root, 'shadow') };
}

test('disabled manager is a no-op and never writes shadow state', async () => {
  const { root, baseDir } = await makeWorkspace('checkpoint-disabled');
  try {
    const mgr = new CheckpointManager({ enabled: false, baseDir });
    const took = await mgr.ensureCheckpoint(join(root, 'project'), 'test');
    assert.equal(took, false);
    assert.equal(existsSync(baseDir), false, 'should not create baseDir when disabled');
    assert.deepEqual(await mgr.listCheckpoints(join(root, 'project')), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('ensureCheckpoint snapshots, dedups within a turn, and re-enables after newTurn', async () => {
  const { root, baseDir } = await makeWorkspace('checkpoint-snapshot');
  const project = join(root, 'project');
  try {
    const mgr = new CheckpointManager({ enabled: true, baseDir });
    await writeFile(join(project, 'a.txt'), 'one', 'utf8');

    const first = await mgr.ensureCheckpoint(project, 'before edit');
    assert.equal(first, true, 'first call should snapshot');

    // Same turn, even with new changes — must dedup.
    await writeFile(join(project, 'a.txt'), 'two', 'utf8');
    const second = await mgr.ensureCheckpoint(project, 'before second edit');
    assert.equal(second, false, 'same-turn second call should dedup');

    // New turn picks up the changed file.
    mgr.newTurn();
    const third = await mgr.ensureCheckpoint(project, 'next turn');
    assert.equal(third, true, 'next turn should snapshot the new state');

    // No changes since the last commit — taken=false.
    mgr.newTurn();
    const fourth = await mgr.ensureCheckpoint(project, 'next turn no changes');
    assert.equal(fourth, false, 'no diff means no commit');

    const entries = await mgr.listCheckpoints(project);
    assert.equal(entries.length, 2, 'two real snapshots');
    assert.match(entries[0]?.reason ?? '', /next turn$/);
    assert.match(entries[1]?.reason ?? '', /before edit/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('restoreCheckpoint rolls a single file back and takes a pre-rollback snapshot', async () => {
  const { root, baseDir } = await makeWorkspace('checkpoint-restore');
  const project = join(root, 'project');
  try {
    const mgr = new CheckpointManager({ enabled: true, baseDir });
    await writeFile(join(project, 'config.yaml'), 'mode: a', 'utf8');
    await mgr.ensureCheckpoint(project, 'before risky change');
    const [original] = await mgr.listCheckpoints(project);
    assert.ok(original);

    mgr.newTurn();
    await writeFile(join(project, 'config.yaml'), 'mode: b', 'utf8');
    await writeFile(join(project, 'unrelated.txt'), 'keep me', 'utf8');

    const restored = await mgr.restoreCheckpoint(project, original.hash, {
      file: 'config.yaml',
    });
    assert.equal(restored.success, true);
    assert.equal(await readFile(join(project, 'config.yaml'), 'utf8'), 'mode: a');
    // Single-file restore must not touch unrelated changes.
    assert.equal(await readFile(join(project, 'unrelated.txt'), 'utf8'), 'keep me');

    // A pre-rollback snapshot must exist so the user can undo the undo.
    const after = await mgr.listCheckpoints(project);
    assert.ok(
      after.some((entry) => /before rollback/.test(entry.reason)),
      'pre-rollback snapshot recorded',
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('restoreCheckpoint rejects invalid hashes and out-of-tree paths', async () => {
  const { root, baseDir } = await makeWorkspace('checkpoint-validate');
  const project = join(root, 'project');
  try {
    const mgr = new CheckpointManager({ enabled: true, baseDir });
    await writeFile(join(project, 'a.txt'), 'x', 'utf8');
    await mgr.ensureCheckpoint(project, 'seed');
    const [entry] = await mgr.listCheckpoints(project);
    assert.ok(entry);

    const badHash = await mgr.restoreCheckpoint(project, 'not-a-hash');
    assert.equal(badHash.success, false);
    assert.match(badHash.error ?? '', /invalid commit hash/);

    const escapeAttempt = await mgr.restoreCheckpoint(project, entry.hash, {
      file: '../etc/passwd',
    });
    assert.equal(escapeAttempt.success, false);
    assert.match(escapeAttempt.error ?? '', /escapes work tree/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('diffCheckpoint returns stat and diff against a recorded snapshot', async () => {
  const { root, baseDir } = await makeWorkspace('checkpoint-diff');
  const project = join(root, 'project');
  try {
    const mgr = new CheckpointManager({ enabled: true, baseDir });
    await writeFile(join(project, 'src.ts'), 'export const x = 1;\n', 'utf8');
    await mgr.ensureCheckpoint(project, 'seed');
    const [entry] = await mgr.listCheckpoints(project);
    assert.ok(entry);

    mgr.newTurn();
    await writeFile(join(project, 'src.ts'), 'export const x = 2;\n', 'utf8');

    const diff = await mgr.diffCheckpoint(project, entry.hash);
    assert.equal(diff.success, true);
    assert.match(diff.stat ?? '', /src\.ts/);
    assert.match(diff.diff ?? '', /-export const x = 1;/);
    assert.match(diff.diff ?? '', /\+export const x = 2;/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('shadow repo is created under baseDir, never inside the project', async () => {
  const { root, baseDir } = await makeWorkspace('checkpoint-isolation');
  const project = join(root, 'project');
  try {
    const mgr = new CheckpointManager({ enabled: true, baseDir });
    await writeFile(join(project, 'a.txt'), 'x', 'utf8');
    await mgr.ensureCheckpoint(project, 'seed');
    assert.equal(existsSync(join(project, '.git')), false, 'no .git inside project');
    assert.equal(existsSync(baseDir), true, 'shadow base exists');
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('ensureCheckpointForPath walks up from a deep file to the project root', async () => {
  const { root, baseDir } = await makeWorkspace('checkpoint-resolve');
  const project = join(root, 'project');
  try {
    const mgr = new CheckpointManager({ enabled: true, baseDir });
    await mkdir(join(project, 'src', 'tui'), { recursive: true });
    await writeFile(join(project, 'src', 'tui', 'foo.ts'), 'x', 'utf8');
    const took = await mgr.ensureCheckpointForPath(
      join(project, 'src', 'tui', 'foo.ts'),
      'before edit',
    );
    assert.equal(took, true);
    const entries = await mgr.listCheckpoints(project);
    assert.equal(entries.length, 1);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
