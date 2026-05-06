import { existsSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { GatewaySandboxLease } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { daemonPathsForConfig } from './daemon-paths.js';
import {
  linkReferenceRoots,
  parseLeaseArgs,
  projectRef,
  runGit,
  safeName,
} from './gateway-sandbox-worktree.js';

export async function sandboxesCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  if (action === 'list') return listSandboxes(args);
  if (action === 'lease') return leaseSandbox(rest, args);
  if (action === 'release') return releaseSandbox(rest[0], args);
  if (action === 'destroy') return destroySandbox(rest[0], args);
  return `Unknown gateway sandboxes command: ${action}\n`;
}

async function listSandboxes(args: SdCliArgs): Promise<string> {
  const root = await sandboxRoot(args);
  const leases = await readLeases(root);
  return leases.length
    ? `gateway sandboxes\n${leases.map(formatLease).join('\n')}\n`
    : 'No gateway sandboxes.\n';
}

async function leaseSandbox(rest: string[], args: SdCliArgs): Promise<string> {
  const options = parseLeaseArgs(rest, args);
  const root = await sandboxRoot(args);
  if (options.backend !== 'worktree') return `Unsupported sandbox backend: ${options.backend}\n`;
  const project = await projectRef(options.projectRoot);
  const id = options.id ?? `sandbox_${Date.now()}_${safeName(project.id)}`;
  const cwd = join(root, 'worktrees', id);
  await mkdir(join(root, 'worktrees'), { recursive: true });
  await runGit(['-C', project.root, 'worktree', 'add', '-b', `snapdragon/${id}`, cwd, 'HEAD']);
  await linkReferenceRoots(cwd, options.referenceRoots);
  const lease: GatewaySandboxLease = {
    id: `lease_${id}`,
    sandboxId: id,
    cwd,
    acquiredAtMs: Date.now(),
    expiresAtMs: options.ttlMs ? Date.now() + options.ttlMs : undefined,
    backend: 'worktree',
    project,
    referenceRoots: options.referenceRoots,
  };
  await writeLease(root, lease);
  return `leased ${lease.id}\n${cwd}\n`;
}

async function releaseSandbox(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway sandboxes release requires <lease-id>\n';
  const root = await sandboxRoot(args);
  const lease = await readLease(root, id);
  if (!lease) return `Unknown sandbox lease: ${id}\n`;
  rmSync(leaseFile(root, id), { force: true });
  return `released ${id}\n`;
}

async function destroySandbox(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway sandboxes destroy requires <lease-id>\n';
  const root = await sandboxRoot(args);
  const lease = await readLease(root, id);
  if (!lease) return `Unknown sandbox lease: ${id}\n`;
  await runGit([
    '-C',
    lease.project?.root ?? lease.cwd,
    'worktree',
    'remove',
    '--force',
    lease.cwd,
  ]);
  rmSync(leaseFile(root, id), { force: true });
  return `destroyed ${id}\n`;
}

async function sandboxRoot(args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  const root = join(daemonPathsForConfig(config).root, 'sandboxes');
  await mkdir(join(root, 'leases'), { recursive: true });
  return root;
}

async function readLeases(root: string): Promise<GatewaySandboxLease[]> {
  const dir = join(root, 'leases');
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map((name) => readLease(root, basename(name, '.json'))),
  ).then((leases) => leases.filter((lease): lease is GatewaySandboxLease => lease !== undefined));
}

async function readLease(root: string, id: string): Promise<GatewaySandboxLease | undefined> {
  try {
    return JSON.parse(await readFile(leaseFile(root, id), 'utf8')) as GatewaySandboxLease;
  } catch {
    return undefined;
  }
}

async function writeLease(root: string, lease: GatewaySandboxLease): Promise<void> {
  await writeFile(leaseFile(root, lease.id), `${JSON.stringify(lease, null, 2)}\n`);
}

function leaseFile(root: string, id: string): string {
  return join(root, 'leases', `${id.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`);
}

function formatLease(lease: GatewaySandboxLease): string {
  const refs = lease.referenceRoots?.length ? ` refs=${lease.referenceRoots.length}` : '';
  const backend = lease.backend ?? 'worktree';
  return `${lease.id}\t${backend}\t${lease.sandboxId}\t${lease.cwd}${refs}`;
}
