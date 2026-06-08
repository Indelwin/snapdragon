import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { GatewaySandboxLease } from '@snapdragon-ai/gateway';

export async function readSandboxLeases(root: string): Promise<GatewaySandboxLease[]> {
  const dir = join(root, 'leases');
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map((name) => readSandboxLease(root, basename(name, '.json'))),
  ).then((leases) => leases.filter((lease): lease is GatewaySandboxLease => lease !== undefined));
}

export async function readSandboxLease(
  root: string,
  id: string,
): Promise<GatewaySandboxLease | undefined> {
  try {
    return JSON.parse(await readFile(sandboxLeaseFile(root, id), 'utf8')) as GatewaySandboxLease;
  } catch {
    return undefined;
  }
}

export async function writeSandboxLease(root: string, lease: GatewaySandboxLease): Promise<void> {
  await writeFile(sandboxLeaseFile(root, lease.id), `${JSON.stringify(lease, null, 2)}\n`);
}

export function sandboxLeaseFile(root: string, id: string): string {
  return join(root, 'leases', `${id.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`);
}

export function mergeSandboxLeases(
  localLeases: GatewaySandboxLease[],
  gatewayLeases: GatewaySandboxLease[],
): GatewaySandboxLease[] {
  const leases = new Map<string, GatewaySandboxLease>();
  for (const lease of gatewayLeases) leases.set(lease.id, lease);
  for (const lease of localLeases) leases.set(lease.id, lease);
  return [...leases.values()].sort((a, b) => b.acquiredAtMs - a.acquiredAtMs);
}

export function formatSandboxLease(lease: GatewaySandboxLease): string {
  const refs = lease.referenceRoots?.length ? ` refs=${lease.referenceRoots.length}` : '';
  const backend = lease.backend ?? 'worktree';
  return `${lease.id}\t${backend}\t${lease.sandboxId}\t${lease.cwd}${refs}`;
}
