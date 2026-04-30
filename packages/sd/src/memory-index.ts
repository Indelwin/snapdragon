import type {
  MemoryEntry,
  MemoryReadRequest,
  MemoryReadResult,
  MemorySearchRequest,
  MemorySearchResult,
} from '@snapdragon-ai/content';
import { type SdMemoryIndexState, syncMemoryIndex } from './memory-index-sync.js';
import type { SdSearchHit, SdSearchIndex } from './search-index.js';

type IndexedMemoryStore = {
  path: string;
  read(request: MemoryReadRequest): MemoryReadResult;
};

const memoryIndexStates = new WeakMap<IndexedMemoryStore, SdMemoryIndexState>();

export function attachMemorySearchIndex(store: IndexedMemoryStore, index: SdSearchIndex): void {
  memoryIndexStates.set(store, { index });
}

export function searchMemoryIndex(
  store: IndexedMemoryStore,
  request: MemorySearchRequest,
): MemorySearchResult[] | undefined {
  const state = memoryIndexStates.get(store);
  if (state === undefined) return undefined;
  const index = state.index;
  if (index === undefined) return undefined;
  try {
    syncMemoryIndex(state, store.path, readAll(store));
    const query = request.query.trim();
    if (query.length === 0) return readLimit(store, request.limit);
    return index
      .search(query, 'memory', { limit: request.limit, touch: true })
      .map(hitToMemoryResult);
  } catch {
    return undefined;
  }
}

function hitToMemoryResult(hit: SdSearchHit): MemorySearchResult {
  return {
    id: hit.id,
    title: hit.title,
    content: hit.body,
    tags: hit.tags,
    source: hit.source,
    score: hit.score,
  };
}

function readAll(store: IndexedMemoryStore): MemoryEntry[] {
  return store.read({}).entries;
}

function readLimit(store: IndexedMemoryStore, limit: number | undefined): MemorySearchResult[] {
  return store.read({ limit }).entries;
}
