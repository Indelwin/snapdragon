import { numberOrNull, tagsText, textOrNull } from './db-values.js';
import { hashEntry } from './hash.js';
import type { SyncStatements } from './statements.js';
import type { SdIndexedKind, SdIndexInputEntry } from './types.js';

export type SyncEntryStatus = 'added' | 'updated' | 'unchanged';

export function syncOneEntry(
  statements: SyncStatements,
  kind: SdIndexedKind,
  entry: SdIndexInputEntry,
): SyncEntryStatus {
  const hash = hashEntry(entry);
  const params = entryParams(kind, entry, hash);
  const existing = statements.select.get({ $kind: kind, $id: entry.id }) as
    | { content_hash: string }
    | undefined;
  if (!existing) {
    statements.insert.run(params);
    return 'added';
  }
  if (existing.content_hash === hash) return 'unchanged';
  statements.update.run(params);
  return 'updated';
}

function entryParams(kind: SdIndexedKind, entry: SdIndexInputEntry, hash: string) {
  return {
    $kind: kind,
    $id: entry.id,
    $title: textOrNull(entry.title),
    $description: textOrNull(entry.description),
    $body: entry.body,
    $tags: tagsText(entry.tags),
    $source: textOrNull(entry.source),
    $path: entry.path,
    $content_hash: hash,
    $created_at: numberOrNull(entry.createdAt),
  };
}
