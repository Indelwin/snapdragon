import type { SyncStatements } from './statements.js';
import type { SdIndexedKind } from './types.js';

export function deleteMissingEntries(
  statements: SyncStatements,
  kind: SdIndexedKind,
  seen: ReadonlySet<string>,
): number {
  let removed = 0;
  const rows = statements.existingIds.all({ $kind: kind }) as Array<{ id: string }>;
  for (const row of rows) {
    if (!seen.has(row.id)) {
      statements.remove.run({ $kind: kind, $id: row.id });
      removed += 1;
    }
  }
  return removed;
}
