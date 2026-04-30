import type { SdIndexInputEntry } from './types.js';

export function hashEntry(entry: SdIndexInputEntry): string {
  const payload = [
    entry.kind,
    entry.id,
    stringValue(entry.title),
    stringValue(entry.description),
    entry.body,
    tagsValue(entry.tags),
  ].join('\u0001');
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function stringValue(value: string | undefined): string {
  if (value === undefined) return '';
  return value;
}

function tagsValue(value: readonly string[] | undefined): string {
  if (value === undefined) return '';
  return value.join(',');
}
