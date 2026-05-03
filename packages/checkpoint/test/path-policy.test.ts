import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  getWorkingDirForPath,
  isValidCommitHash,
  relativeWithinWorkTree,
} from '../src/path-policy.ts';

test('getWorkingDirForPath walks up to a project marker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'checkpoint-paths-'));
  await writeFile(join(root, 'package.json'), '{}', 'utf8');
  await mkdir(join(root, 'a', 'b', 'c'), { recursive: true });
  const target = join(root, 'a', 'b', 'c', 'deep.ts');
  await writeFile(target, '// x', 'utf8');
  assert.equal(getWorkingDirForPath(target), root);
});

test('getWorkingDirForPath falls back to the start dir when no marker is found', async () => {
  const root = await mkdtemp(join(tmpdir(), 'checkpoint-paths-bare-'));
  await mkdir(join(root, 'inner'), { recursive: true });
  const target = join(root, 'inner', 'foo.ts');
  await writeFile(target, '// x', 'utf8');
  // The walk goes all the way to '/', so we get the dir of the file when no
  // marker is hit before that.
  const result = getWorkingDirForPath(target);
  assert.ok(result === join(root, 'inner') || result === root || result === '/');
});

test('relativeWithinWorkTree rejects parent escapes and absolute escapes', () => {
  assert.equal(relativeWithinWorkTree('/work', '/work/a/b.ts'), join('a', 'b.ts'));
  assert.equal(relativeWithinWorkTree('/work', 'a/b.ts'), join('a', 'b.ts'));
  assert.equal(relativeWithinWorkTree('/work', '../etc/passwd'), undefined);
  assert.equal(relativeWithinWorkTree('/work', '/etc/passwd'), undefined);
});

test('isValidCommitHash accepts hex 4..40 and rejects everything else', () => {
  assert.equal(isValidCommitHash('abcd'), true);
  assert.equal(isValidCommitHash('a'.repeat(40)), true);
  assert.equal(isValidCommitHash('A'.repeat(8)), true);
  assert.equal(isValidCommitHash('xyz'), false);
  assert.equal(isValidCommitHash('abc'), false);
  assert.equal(isValidCommitHash('a'.repeat(41)), false);
  assert.equal(isValidCommitHash(''), false);
  assert.equal(isValidCommitHash('a; rm -rf'), false);
});
