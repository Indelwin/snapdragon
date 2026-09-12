import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixtureGitEnvironment } from './fixtures/git-environment.mjs';

const fixtureTest = fileURLToPath(new URL('./git-changes.test.mjs', import.meta.url));
const hookRoot = fileURLToPath(new URL('../../../.githooks/', import.meta.url));

test('Git change fixtures ignore hostile outer repository environment', (t) => {
  const root = temporaryRoot(t);
  const outer = createRepository(join(root, 'outer'));
  const before = snapshot(outer);
  execFileSync(process.execPath, ['--test', fixtureTest], {
    cwd: outer,
    env: hostileEnvironment(outer),
    timeout: 15_000,
    stdio: 'pipe',
  });
  assert.deepEqual(snapshot(outer), before);
});

for (const hook of ['pre-commit', 'pre-push']) {
  test(`${hook} clears repository-local Git variables before every npm check and keeps cwd`, (t) => {
    const root = temporaryRoot(t);
    const outer = createRepository(join(root, 'outer'));
    const project = createRepository(join(root, 'project'));
    const cwd = join(project, 'nested');
    mkdirSync(cwd);
    const before = snapshot(outer);
    const projectBefore = snapshot(project);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const recordPath = join(root, 'checks.jsonl');
    writeFileSync(join(bin, 'npm'), npmProbe, { mode: 0o755 });
    const localNames = git(outer, 'rev-parse', '--local-env-vars').split('\n');
    execFileSync('sh', [join(hookRoot, hook)], {
      cwd,
      env: {
        ...hostileEnvironment(outer),
        PATH: `${bin}:${process.env.PATH}`,
        HOOK_PROBE_ROOT: root,
        HOOK_PROBE_RECORD: recordPath,
        HOOK_PROBE_CWD: realpathSync(cwd),
        HOOK_PROBE_LOCAL_NAMES: JSON.stringify(localNames),
        SNAPDRAGON_MUTATION_ON_PUSH: '1',
      },
      timeout: 15_000,
      stdio: 'pipe',
    });
    const checks = readFileSync(recordPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      checks,
      hook === 'pre-commit'
        ? [['run', 'check:fast']]
        : [
            ['run', 'check:push'],
            ['run', 'mutation:js'],
            ['run', 'mutation:rust'],
          ],
    );
    assert.deepEqual(snapshot(outer), before);
    assert.deepEqual(snapshot(project), projectBefore);
  });
}

function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'quality-hook-isolation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: fixtureGitEnvironment(), encoding: 'utf8' }).trim();
}

function createRepository(root) {
  mkdirSync(root);
  git(root, 'init', '-q', '--template=');
  git(root, 'config', 'user.name', 'Outer owner');
  git(root, 'config', 'user.email', 'outer@example.invalid');
  writeFileSync(join(root, 'original.txt'), 'original contents\n');
  git(root, 'add', '.');
  git(root, '-c', `core.hooksPath=${devNull}`, 'commit', '-qm', 'original');
  writeFileSync(join(root, 'staged.txt'), 'preserve staged contents\n');
  git(root, 'add', 'staged.txt');
  return root;
}

function snapshot(root) {
  return {
    head: git(root, 'rev-parse', 'HEAD'),
    refs: git(root, 'show-ref'),
    config: readFileSync(join(root, '.git', 'config')),
    index: readFileSync(join(root, '.git', 'index')),
    original: readFileSync(join(root, 'original.txt')),
    staged: readFileSync(join(root, 'staged.txt')),
  };
}

function hostileEnvironment(outer) {
  const dir = join(outer, '.git');
  return {
    ...fixtureGitEnvironment(),
    GIT_DIR: dir,
    GIT_COMMON_DIR: dir,
    GIT_WORK_TREE: outer,
    GIT_INDEX_FILE: join(dir, 'index'),
    GIT_OBJECT_DIRECTORY: join(dir, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(dir, 'objects'),
    GIT_CONFIG: join(dir, 'config'),
    GIT_CONFIG_PARAMETERS: "'user.name'='Hostile identity'",
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.bare',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_PREFIX: 'foreign/',
  };
}

const npmProbe = `#!/usr/bin/env node
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { appendFileSync, mkdtempSync, realpathSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
for (const name of JSON.parse(process.env.HOOK_PROBE_LOCAL_NAMES)) {
  assert.equal(process.env[name], undefined, name + ' leaked into npm');
}
assert.equal(realpathSync(process.cwd()), process.env.HOOK_PROBE_CWD);
const cwd = mkdtempSync(join(process.env.HOOK_PROBE_ROOT, 'unsafe-npm-fixture-'));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
git('init', '-q', '--template=');
assert.equal(realpathSync(git('rev-parse', '--show-toplevel')), realpathSync(cwd));
git('config', 'user.name', 'Nested fixture owner');
writeFileSync(join(cwd, 'fixture.txt'), 'fixture contents');
git('add', '.');
appendFileSync(process.env.HOOK_PROBE_RECORD, JSON.stringify(process.argv.slice(2)) + '\\n');
`;
