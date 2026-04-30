import type { DatabaseSync } from 'node:sqlite';
import { syncStatements } from './statements.js';
import { deleteMissingEntries } from './sync-delete.js';
import { syncOneEntry } from './sync-one.js';
import type { SdIndexedKind, SdIndexInputEntry, SdIndexSyncResult } from './types.js';

export function syncEntries(
  db: DatabaseSync,
  kind: SdIndexedKind,
  entries: readonly SdIndexInputEntry[],
): SdIndexSyncResult {
  const result: SdIndexSyncResult = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  const seen = new Set<string>();
  const statements = syncStatements(db);
  db.exec('BEGIN');
  try {
    for (const entry of entries.filter((candidate) => candidate.kind === kind)) {
      seen.add(entry.id);
      result[syncOneEntry(statements, kind, entry)] += 1;
    }
    result.removed = deleteMissingEntries(statements, kind, seen);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
