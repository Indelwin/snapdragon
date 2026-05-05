import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DEFAULT_SD_DAEMON_ROOT, type SdConfig } from './config.js';

export interface SdGatewayChannelTarget {
  platform: string;
  id: string;
  target: string;
}

export interface SdGatewayChannelDescriptor extends SdGatewayChannelTarget {
  name?: string;
  type?: string;
  root: string;
  session_root: string;
  skills_root: string;
  workspace: string;
  home: string;
  logs: string;
  log_file: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface SdGatewayChannelLogEntry {
  at?: string;
  type: string;
  message?: string;
  data?: unknown;
}

export interface SdGatewayChannelEnsureOptions {
  name?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

export interface SdGatewayChannelStore {
  readonly root: string;
  ensure(
    target: string,
    options?: SdGatewayChannelEnsureOptions,
  ): Promise<SdGatewayChannelDescriptor>;
  ensureSync(target: string, options?: SdGatewayChannelEnsureOptions): SdGatewayChannelDescriptor;
  list(filter?: { platform?: string }): Promise<SdGatewayChannelDescriptor[]>;
  listSync(filter?: { platform?: string }): SdGatewayChannelDescriptor[];
  appendLog(target: string, entry: SdGatewayChannelLogEntry): Promise<void>;
}

export function gatewayChannelRootForConfig(config: SdConfig): string {
  const configured = config.background?.channels?.root;
  const daemonRoot = config.background?.daemon?.root ?? DEFAULT_SD_DAEMON_ROOT;
  return resolve(configured ?? join(daemonRoot, 'channels'));
}

export function defaultGatewayChannelPlatform(config: SdConfig): string {
  return config.background?.channels?.default_platform ?? 'local';
}

export function normalizeGatewayChannelTarget(
  input: string,
  defaultPlatform = 'local',
): SdGatewayChannelTarget {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Channel target is required.');
  const match = /^([A-Za-z][A-Za-z0-9_-]*):(.+)$/.exec(trimmed);
  if (!match && trimmed.includes(':')) throw new Error(`Invalid channel target: ${input}`);
  const platform = normalizeGatewayChannelPlatform(match?.[1] ?? defaultPlatform);
  const id = (match?.[2] ?? trimmed).trim();
  if (!id || id === '.' || id === '..') throw new Error(`Invalid channel target: ${input}`);
  return { platform, id, target: `${platform}:${id}` };
}

export function channelRootForTarget(root: string, target: SdGatewayChannelTarget): string {
  return join(resolve(root), target.platform, safePathPart(target.id));
}

export function normalizeGatewayChannelPlatform(input: string): string {
  const platform = input.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(platform)) {
    throw new Error(`Invalid channel platform: ${input}`);
  }
  return platform;
}

function safePathPart(input: string): string {
  const readable = input.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'channel';
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 10);
  return `${readable.slice(0, 80)}-${hash}`;
}
