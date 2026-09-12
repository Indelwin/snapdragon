import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { changedLineRanges } from '../lib/diff.mjs';
import { changedFiles } from '../lib/git.mjs';
import { fixtureGitEnvironment } from './fixtures/git-environment.mjs';

test('changed sources include working edits and new files but exclude deletions', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'quality-git-changes-'));
  const env = fixtureGitEnvironment();
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
  const write = (path, text) => writeFileSync(join(cwd, path), text);
  try {
    git('init', '-q');
    for (const name of ['edited.ts', 'deleted.ts', 'renamed.ts'])
      write(name, 'export const value = 1;\n');
    git('add', '.');
    git(
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.name=Quality fixture',
      '-c',
      'user.email=quality@example.invalid',
      'commit',
      '-qm',
      'fixture',
    );
    const base = git('rev-parse', 'HEAD');
    write('edited.ts', 'export const value = 2;\n');
    rmSync(join(cwd, 'deleted.ts'));
    renameSync(join(cwd, 'renamed.ts'), join(cwd, 'renamed destination.ts'));
    git('add', '-A');
    write('new file.ts', 'export function added() { return true; }\n');
    write('edited.ts', 'export const value = 3;\n');
    assert.deepEqual((await changedFiles(base, { cwd, env })).sort(), [
      'edited.ts',
      'new file.ts',
      'renamed destination.ts',
    ]);
    assert.deepEqual(await changedLineRanges(base, 'edited.ts', { cwd, env }), [
      { start: 1, end: 1 },
    ]);
    assert.deepEqual(await changedLineRanges(base, 'new file.ts', { cwd, env }), [
      { start: 1, end: Number.MAX_SAFE_INTEGER },
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
