import type { SessionContextChunkReference } from './records.js';

export function contiguousContextReferences(references: SessionContextChunkReference[]): boolean {
  const ids = new Set<number>();
  for (const [index, reference] of references.entries()) {
    if (ids.has(reference.chunk_id)) return false;
    ids.add(reference.chunk_id);
    if (index > 0 && references[index - 1].range_end + 1 !== reference.range_start) return false;
  }
  return true;
}
