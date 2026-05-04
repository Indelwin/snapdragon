import type { SessionOpenRecord } from '../records.js';
import type { ExistingSessionRow } from './session-upsert-types.js';

export function resolveTitle(
  existing: ExistingSessionRow | undefined,
  openRecord: SessionOpenRecord | undefined,
): string | null {
  const fromMeta = readTitle(openRecord?.meta);
  if (fromMeta) return fromMeta;
  return existing?.title ?? null;
}

function readTitle(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const value = meta.title;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
