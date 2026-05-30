import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isRecord } from './pi-rpc-json.js';
import type { PiRpcAgentRunResult } from './pi-rpc-types.js';

export function textDelta(event: Record<string, unknown>): string | undefined {
  const assistantMessageEvent = event.assistantMessageEvent;
  if (!isRecord(assistantMessageEvent) || assistantMessageEvent.type !== 'text_delta') {
    return undefined;
  }
  return typeof assistantMessageEvent.delta === 'string' ? assistantMessageEvent.delta : undefined;
}

export function assistantText(message: unknown): string | undefined {
  if (!isRecord(message) || message.role !== 'assistant') return undefined;
  if (!Array.isArray(message.content)) return undefined;
  const parts = message.content.flatMap((part) => {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') return [];
    return [part.text];
  });
  return parts.join('');
}

export function summarize(content: string): string | undefined {
  const firstLine = content.trim().split(/\r?\n/, 1)[0] ?? '';
  if (!firstLine) return undefined;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

export async function writeOutputArtifact(
  outputArtifact: string,
  result: PiRpcAgentRunResult,
  cwd?: string,
): Promise<string> {
  const artifactPath = resolve(cwd ?? process.cwd(), outputArtifact);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return artifactPath;
}

export function requestId(type: string): string {
  return `sd_pi_${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function stringField(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
