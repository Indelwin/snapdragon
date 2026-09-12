import { isRecord } from './pi-rpc-json.js';

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

export function requestId(type: string): string {
  return `sd_pi_${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function stringField(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
