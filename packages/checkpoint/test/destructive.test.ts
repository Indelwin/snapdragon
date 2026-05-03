import assert from 'node:assert/strict';
import test from 'node:test';
import { isDestructiveCommand } from '../src/destructive.ts';

test('isDestructiveCommand catches deletion, move, in-place edit, git mutation, deps', () => {
  for (const cmd of [
    'rm -rf node_modules',
    'rmdir build',
    'mv a b',
    'unlink foo',
    'truncate -s 0 foo',
    'dd if=/dev/zero of=foo',
    'sed -i s/foo/bar/g file',
    "perl -i -pe 's/x/y/' file",
    'git reset --hard HEAD',
    'git checkout main -- foo',
    'git restore foo',
    'git clean -fdx',
    'git rebase main',
    'git revert HEAD',
    'npm install left-pad',
    'npm i lodash',
    'npm uninstall foo',
    'cargo add anyhow',
    'cargo clean',
    'pip install requests',
    'echo data > out.txt',
  ]) {
    assert.equal(isDestructiveCommand(cmd), true, `expected destructive: ${cmd}`);
  }
});

test('isDestructiveCommand permits read-only and append-only commands', () => {
  for (const cmd of [
    'ls -la',
    'cat file',
    'grep foo bar',
    'git status',
    'git diff',
    'git log --oneline',
    'echo data >> out.txt', // append, not overwrite
    'npm test',
    'npm run build',
    'cargo build',
    'cargo test',
    '',
  ]) {
    assert.equal(isDestructiveCommand(cmd), false, `expected non-destructive: ${cmd}`);
  }
});
