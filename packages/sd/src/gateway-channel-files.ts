import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  channelRootForTarget,
  type SdGatewayChannelDescriptor,
  type SdGatewayChannelEnsureOptions,
  type SdGatewayChannelTarget,
} from './gateway-channel-types.js';

export function descriptorFrom(
  target: SdGatewayChannelTarget,
  root: string,
  options: SdGatewayChannelEnsureOptions,
  existing?: SdGatewayChannelDescriptor,
): SdGatewayChannelDescriptor {
  const channelRoot = channelRootForTarget(root, target);
  const now = new Date().toISOString();
  return {
    ...target,
    name: options.name ?? existing?.name,
    type: options.type ?? existing?.type,
    root: channelRoot,
    session_root: join(channelRoot, 'sessions'),
    skills_root: join(channelRoot, 'skills'),
    workspace: join(channelRoot, 'workspace'),
    home: join(channelRoot, 'home'),
    logs: join(channelRoot, 'logs'),
    log_file: join(channelRoot, 'log.jsonl'),
    created_at: existing?.created_at ?? now,
    updated_at: now,
    metadata: { ...(existing?.metadata ?? {}), ...(options.metadata ?? {}) },
  };
}

export async function ensureChannelDirectories(
  descriptor: SdGatewayChannelDescriptor,
): Promise<void> {
  await Promise.all(channelDirs(descriptor).map((path) => mkdir(path, { recursive: true })));
}

export function ensureChannelDirectoriesSync(descriptor: SdGatewayChannelDescriptor): void {
  for (const path of channelDirs(descriptor)) mkdirSync(path, { recursive: true });
}

export async function readExistingDescriptor(
  path: string,
): Promise<SdGatewayChannelDescriptor | undefined> {
  try {
    return parseDescriptor(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export function readExistingDescriptorSync(path: string): SdGatewayChannelDescriptor | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return parseDescriptor(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

export async function writeDescriptor(descriptor: SdGatewayChannelDescriptor): Promise<void> {
  await mkdir(descriptor.root, { recursive: true });
  await writeFile(
    join(descriptor.root, 'channel.json'),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
}

export function writeDescriptorSync(descriptor: SdGatewayChannelDescriptor): void {
  mkdirSync(descriptor.root, { recursive: true });
  writeFileSync(join(descriptor.root, 'channel.json'), `${JSON.stringify(descriptor, null, 2)}\n`);
}

export function listDescriptors(root: string, platform?: string): SdGatewayChannelDescriptor[] {
  if (!existsSync(root)) return [];
  const platforms = platform ? [platform] : dirNames(root);
  return platforms.flatMap((name) => listPlatformDescriptors(root, name));
}

export function descriptorPath(root: string, target: SdGatewayChannelTarget): string {
  return join(channelRootForTarget(root, target), 'channel.json');
}

function listPlatformDescriptors(root: string, platform: string): SdGatewayChannelDescriptor[] {
  return dirNames(join(root, platform))
    .map((name) => readExistingDescriptorSync(join(root, platform, name, 'channel.json')))
    .filter((item): item is SdGatewayChannelDescriptor => Boolean(item));
}

function dirNames(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function parseDescriptor(raw: string): SdGatewayChannelDescriptor {
  const parsed = JSON.parse(raw) as SdGatewayChannelDescriptor;
  if (!parsed.target || !parsed.platform || !parsed.id || !parsed.root) {
    throw new Error('Invalid channel descriptor.');
  }
  return parsed;
}

function channelDirs(descriptor: SdGatewayChannelDescriptor): string[] {
  return [
    descriptor.root,
    descriptor.session_root,
    descriptor.skills_root,
    descriptor.workspace,
    descriptor.home,
    descriptor.logs,
  ];
}
