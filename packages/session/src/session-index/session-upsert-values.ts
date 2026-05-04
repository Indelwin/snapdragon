import {
  resolveCreatedAt,
  resolveMessageCount,
  resolveTitle,
  resolveUpdatedAt,
} from './session-upsert-resolvers.js';
import type { ExistingSessionRow, UpsertSessionArgs } from './session-upsert-types.js';

export function buildUpsertParams(
  existing: ExistingSessionRow | undefined,
  args: UpsertSessionArgs,
) {
  return {
    $sid: args.sessionId,
    $path: args.jsonlPath,
    $created: resolveCreatedAt(existing, args.openRecord),
    $updated: resolveUpdatedAt(existing, args),
    $title: resolveTitle(existing, args.openRecord),
    $count: resolveMessageCount(existing, args),
    $size: args.jsonlSize,
    $mtime: args.jsonlMtime,
    $offset: args.lastIndexedOffset,
  };
}
