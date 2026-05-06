import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { stringify as stringifyYaml } from 'yaml';
import { runGatewayCommand } from '../src/gateway-command.ts';

const execFileAsync = promisify(execFile);

test('gateway worktree sandbox leases project metadata and reference roots', async () => {
  const root = join(tmpdir(), `snapdragon-sandbox-${process.pid}-${Date.now()}`);
  const repo = join(root, 'repo');
  const reference = join(root, 'reference');
  const gatewayRoot = join(root, 'gateway');
  const configPath = join(root, 'config.yaml');
  await mkdir(reference, { recursive: true });
  await writeFile(join(reference, 'README.md'), 'reference\n');
  await initGitRepo(repo);
  await writeFile(
    configPath,
    stringifyYaml({ version: 1, gateway: { runtime: 'rust', root: gatewayRoot } }),
  );
  try {
    const args = { configPath, cwd: repo } as any;
    const leased = await runGatewayCommand({
      ...args,
      gatewayArgs: [
        'sandboxes',
        'lease',
        repo,
        '--id',
        'test-sandbox',
        '--ref',
        reference,
        '--ttl-ms',
        '1000',
      ],
    });
    assert.match(leased, /leased lease_test-sandbox/);
    const leasePath = join(gatewayRoot, 'sandboxes', 'leases', 'lease_test-sandbox.json');
    const lease = JSON.parse(await readFile(leasePath, 'utf8'));
    assert.equal(lease.backend, 'worktree');
    assert.equal(lease.project.root, await realpath(repo));
    assert.deepEqual(lease.referenceRoots, [reference]);
    assert.equal(
      existsSync(
        join(
          gatewayRoot,
          'sandboxes',
          'worktrees',
          'test-sandbox',
          '.snapdragon',
          'references',
          basename(reference),
        ),
      ),
      true,
    );
    assert.match(
      await runGatewayCommand({ ...args, gatewayArgs: ['sandboxes', 'list'] }),
      /lease_test-sandbox\tworktree\t/,
    );
    assert.match(
      await runGatewayCommand({
        ...args,
        gatewayArgs: ['sandboxes', 'destroy', 'lease_test-sandbox'],
      }),
      /destroyed lease_test-sandbox/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function initGitRepo(repo: string): Promise<void> {
  await mkdir(repo, { recursive: true });
  await git(['init', '-b', 'main'], repo);
  await git(['config', 'user.name', 'Snapdragon Test'], repo);
  await git(['config', 'user.email', 'test@example.invalid'], repo);
  await writeFile(join(repo, 'README.md'), 'repo\n');
  await git(['add', 'README.md'], repo);
  await git(['commit', '-m', 'init'], repo);
}

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync('git', args, { cwd });
}
