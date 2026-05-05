import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DEFAULT_SD_DAEMON_ROOT, type SdConfig } from './config.js';

export type SdGatewayChannelEventType = 'immediate' | 'one-shot' | 'periodic';
export type SdGatewayChannelEventState = 'pending' | 'running' | 'done' | 'failed';

export interface SdGatewayChannelEventInput {
  id?: string;
  type?: SdGatewayChannelEventType;
  channel: string;
  prompt: string;
  title?: string;
  at?: string;
  next_at?: string;
  interval_ms?: number;
  max_tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface SdGatewayChannelEvent extends SdGatewayChannelEventInput {
  id: string;
  type: SdGatewayChannelEventType;
  created_at: string;
}

export interface SdGatewayChannelEventClaim {
  event: SdGatewayChannelEvent;
  running_path: string;
  pending_path: string;
}

export interface SdGatewayChannelEventResult {
  status: 'done' | 'failed';
  completed_at: string;
  output?: string;
  error?: string;
  result_file?: string;
}

export interface SdGatewayChannelEventWriteResult {
  event: SdGatewayChannelEvent;
  path: string;
}

export function gatewayEventRootForConfig(config: SdConfig): string {
  const configured = config.background?.channels?.events?.root;
  const daemonRoot = config.background?.daemon?.root ?? DEFAULT_SD_DAEMON_ROOT;
  return resolve(configured ?? join(daemonRoot, 'events'));
}

export function normalizeGatewayChannelEvent(
  input: SdGatewayChannelEventInput,
): SdGatewayChannelEvent {
  const now = new Date().toISOString();
  return {
    ...input,
    id: sanitizeEventId(input.id ?? generatedEventId(input, now)),
    type: input.type ?? 'immediate',
    created_at: now,
  };
}

export function eventPath(root: string, state: SdGatewayChannelEventState, id: string): string {
  return join(root, state, `${sanitizeEventId(id)}.json`);
}

export function isGatewayChannelEventDue(event: SdGatewayChannelEvent, nowMs: number): boolean {
  if (event.type === 'immediate') return true;
  const dueAt = Date.parse(event.next_at ?? event.at ?? '');
  return Number.isFinite(dueAt) && dueAt <= nowMs;
}

function generatedEventId(input: SdGatewayChannelEventInput, now: string): string {
  const hash = createHash('sha256')
    .update(`${input.channel}\n${input.prompt}\n${now}`)
    .digest('hex')
    .slice(0, 8);
  return `${now.replace(/[-:.TZ]/g, '')}_${hash}`;
}

function sanitizeEventId(input: string): string {
  const safe = input.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!safe || safe === '.' || safe === '..') throw new Error(`Invalid channel event id: ${input}`);
  return safe.slice(0, 120);
}
