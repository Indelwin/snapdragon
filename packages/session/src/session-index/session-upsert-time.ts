import type { SessionOpenRecord } from '../records.js';
import type { ExistingSessionRow, UpsertSessionArgs } from './session-upsert-types.js';

export function resolveCreatedAt(
  existing: ExistingSessionRow | undefined,
  openRecord: SessionOpenRecord | undefined,
): number | null {
  if (existing?.created_at != null) return existing.created_at;
  return openRecord?.created_at ?? null;
}

export function resolveUpdatedAt(
  existing: ExistingSessionRow | undefined,
  args: UpsertSessionArgs,
): number {
  if (args.lastMessageTs != null) return args.lastMessageTs;
  if (existing?.created_at != null) return existing.created_at;
  return args.jsonlMtime;
}
