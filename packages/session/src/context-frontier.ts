import { validContextChunkShape } from './context-chunk-shape.js';
import type { ContextFrontierState } from './context-frontier-types.js';
import { validRollupChunk } from './context-rollup-validation.js';
import type { SessionContextChunkRecord } from './records.js';

export type { ContextFrontierState } from './context-frontier-types.js';

export function activeContextChunks(
  chunks: readonly SessionContextChunkRecord[],
): SessionContextChunkRecord[] {
  const state = createContextFrontier();
  for (const chunk of chunks) applyContextChunk(state, chunk);
  return sortedActiveChunks(state);
}

export function createContextFrontier(): ContextFrontierState {
  return { active: new Map(), maxChunkId: 0 };
}

export function sortedActiveChunks(state: ContextFrontierState): SessionContextChunkRecord[] {
  return [...state.active.values()].sort(
    (a, b) => a.range_start - b.range_start || a.chunk_id - b.chunk_id,
  );
}

export function applyContextChunk(
  state: ContextFrontierState,
  chunk: SessionContextChunkRecord,
): boolean {
  if (!validContextChunkShape(chunk) || chunk.chunk_id <= state.maxChunkId) return false;
  const valid =
    chunk.kind === 'rollup' ? validRollupChunk(state, chunk) : validLeafChunk(state, chunk);
  if (!valid) return false;
  for (const child of chunk.child_chunks ?? []) state.active.delete(child.chunk_id);
  state.active.set(chunk.chunk_id, chunk);
  state.maxChunkId = chunk.chunk_id;
  return true;
}

function validLeafChunk(state: ContextFrontierState, chunk: SessionContextChunkRecord): boolean {
  if (chunk.kind === 'rollup' || (chunk.child_chunks?.length ?? 0) > 0) return false;
  if ((chunk.depth ?? 0) !== 0) return false;
  const activeEnd = [...state.active.values()].reduce(
    (highest, active) => Math.max(highest, active.range_end),
    0,
  );
  return chunk.range_start === activeEnd + 1;
}
