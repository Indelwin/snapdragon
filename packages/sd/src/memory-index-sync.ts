import { statSync } from 'node:fs';
import type { MemoryEntry } from '@snapdragon-ai/content';
import type { SdIndexInputEntry, SdSearchIndex } from './search-index.js';

export type SdMemoryIndexState = Partial<{
  index: SdSearchIndex;
  lastSyncedMtime: number;
}>;

export function syncMemoryIndex(
  state: SdMemoryIndexState,
  path: string,
  entries: readonly MemoryEntry[],
): void {
  const index = state.index;
  if (index === undefined) return;
  const mtime = currentMtime(path);
  if (mtime === state.lastSyncedMtime) return;
  index.sync(
    'memory',
    entries.map((entry) => memoryEntryToIndex(path, entry)),
  );
  state.lastSyncedMtime = mtime;
}

function memoryEntryToIndex(path: string, entry: MemoryEntry): SdIndexInputEntry {
  return {
    kind: 'memory',
    id: entry.id,
    title: entry.title,
    body: entry.content,
    tags: entry.tags,
    source: entry.source,
    path: `${path}#${entry.id}`,
    createdAt: timestamp(entry.createdAt),
  };
}

function timestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Date.parse(value);
}

function currentMtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
