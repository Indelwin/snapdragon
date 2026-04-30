#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.cwd();
const coverageRoot = join(root, '.quality', 'coverage');
const rawCoverageDir = join(coverageRoot, 'raw');

await rm(rawCoverageDir, { recursive: true, force: true });
await mkdir(rawCoverageDir, { recursive: true });

for (const workspace of await testWorkspaces()) {
  await runWorkspaceTests(workspace);
}

console.log(`Node coverage written to ${rawCoverageDir}`);

async function testWorkspaces() {
  const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const out = [];
  for (const workspace of rootPackage.workspaces) {
    const packagePath = join(root, workspace, 'package.json');
    const packageJson = await readPackage(packagePath);
    if (packageJson?.scripts?.test)
      out.push({ dir: join(root, workspace), script: packageJson.scripts.test });
  }
  return out;
}

async function readPackage(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

async function runWorkspaceTests(workspace) {
  const testFiles = await workspaceTestFiles(workspace.dir);
  if (testFiles.length === 0) return;
  const args = ['--test', '--experimental-test-coverage', '--import', 'tsx', ...testFiles];
  const code = await spawnNode(args, workspace.dir);
  if (code !== 0) process.exit(code);
}

async function workspaceTestFiles(dir) {
  const testDir = join(dir, 'test');
  const files = await readdir(testDir).catch(() => []);
  return files.filter((file) => file.endsWith('.test.ts')).map((file) => resolve(testDir, file));
}

function spawnNode(args, cwd) {
  return new Promise((resolveCode) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, NODE_V8_COVERAGE: rawCoverageDir },
      stdio: 'inherit',
    });
    child.on('close', resolveCode);
  });
}
