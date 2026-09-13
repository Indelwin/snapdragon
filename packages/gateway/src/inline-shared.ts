import type { InlineLogStore } from './inline-logs.js';

export function inlineLogger(logs: InlineLogStore) {
  return (level: string, target: string | undefined, message: string, data?: unknown) =>
    logs.append({ level, target, message, data, atMs: Date.now() });
}

export function inlineId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
