import { rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GatewaySandboxLease } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { daemonPathsForConfig } from './daemon-paths.js';
import {
  formatSandboxLease,
  mergeSandboxLeases,
  readSandboxLease,
  readSandboxLeases,
  sandboxLeaseFile,
  writeSandboxLease,
} from './gateway-sandbox-leases.js';
import {
  listGatewaySandboxLeases,
  registerGatewaySandboxLease,
  releaseGatewaySandboxLease,
} from './gateway-sandbox-sync.js';
import {
  linkReferenceRoots,
  parseLeaseArgs,
  projectRef,
  runGit,
  safeName,
} from './gateway-sandbox-worktree.js';

type SandboxAction = (rest: string[], args: SdCliArgs) => Promise<string>;

const sandboxActions: Record<string, SandboxAction> = {
  list: (_rest, args) => listSandboxes(args),
  lease: leaseSandbox,
  release: (rest, args) => releaseSandbox(rest[0], args),
  destroy: (rest, args) => destroySandbox(rest[0], args),
};

export async function sandboxesCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  const handler = sandboxActions[action];
  return handler ? handler(rest, args) : `Unknown gateway sandboxes command: ${action}\n`;
}

async function listSandboxes(args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  const root = await sandboxRootForConfig(config);
  const localLeases = await readSandboxLeases(root);
  const { leases: gatewayLeases, error } = await listGatewaySandboxLeases(config);
  const leases = mergeSandboxLeases(localLeases, gatewayLeases);
  const warning = error ? `\nRust gateway unavailable; showing local leases only: ${error}\n` : '';
  return leases.length
    ? `gateway sandboxes\n${leases.map(formatSandboxLease).join('\n')}${warning}\n`
    : `No gateway sandboxes.${warning}\n`;
}

async function leaseSandbox(rest: string[], args: SdCliArgs): Promise<string> {
  const options = parseLeaseArgs(rest, args);
  const config = await loadSdConfig(args.configPath);
  const root = await sandboxRootForConfig(config);
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
  await writeSandboxLease(root, lease);
  const error = await registerGatewaySandboxLease(config, lease);
  const warning = error ? `local only; rust gateway unavailable: ${error}\n` : '';
  return `leased ${lease.id}\n${cwd}\n${warning}`;
}

async function releaseSandbox(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway sandboxes release requires <lease-id>\n';
  const config = await loadSdConfig(args.configPath);
  const root = await sandboxRootForConfig(config);
  const lease = await readSandboxLease(root, id);
  const gatewayLease = await releaseGatewaySandboxLease(config, id);
  if (!lease && !gatewayLease.lease) return `Unknown sandbox lease: ${id}\n`;
  rmSync(sandboxLeaseFile(root, id), { force: true });
  const warning = gatewayLease.error
    ? `local release only; rust gateway unavailable: ${gatewayLease.error}\n`
    : '';
  return `released ${id}\n${warning}`;
}

async function destroySandbox(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway sandboxes destroy requires <lease-id>\n';
  const config = await loadSdConfig(args.configPath);
  const root = await sandboxRootForConfig(config);
  const lease = await readSandboxLease(root, id);
  const gatewayLease = await releaseGatewaySandboxLease(config, id);
  const resolvedLease = lease ?? gatewayLease.lease;
  if (!resolvedLease) return `Unknown sandbox lease: ${id}\n`;
  await runGit([
    '-C',
    resolvedLease.project?.root ?? resolvedLease.cwd,
    'worktree',
    'remove',
    '--force',
    resolvedLease.cwd,
  ]);
  rmSync(sandboxLeaseFile(root, id), { force: true });
  const warning = gatewayLease.error
    ? `local destroy only; rust gateway unavailable: ${gatewayLease.error}\n`
    : '';
  return `destroyed ${id}\n${warning}`;
}

async function sandboxRootForConfig(
  config: Awaited<ReturnType<typeof loadSdConfig>>,
): Promise<string> {
  const root = join(daemonPathsForConfig(config).root, 'sandboxes');
  await mkdir(join(root, 'leases'), { recursive: true });
  return root;
}
