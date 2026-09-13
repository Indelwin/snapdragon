import type { ContextFrontierState } from './context-frontier-types.js';
import { contiguousContextReferences } from './context-reference-order.js';
import type { SessionContextChunkRecord, SessionContextChunkReference } from './records.js';

export function validRollupChunk(
  state: ContextFrontierState,
  chunk: SessionContextChunkRecord,
): boolean {
  const references = chunk.child_chunks;
  if (chunk.kind !== 'rollup' || !references || references.length < 1) return false;
  const children = references.map((reference) => state.active.get(reference.chunk_id));
  if (children.some((child) => child === undefined)) return false;
  const resolved = children as SessionContextChunkRecord[];
  return (
    exactParentRange(chunk, references) &&
    exactChildReferences(references, resolved) &&
    contiguousContextReferences(references) &&
    exactRollupDepth(chunk, resolved)
  );
}

function exactParentRange(
  chunk: SessionContextChunkRecord,
  references: SessionContextChunkReference[],
): boolean {
  return (
    references[0].range_start === chunk.range_start &&
    references.at(-1)?.range_end === chunk.range_end
  );
}

function exactChildReferences(
  references: SessionContextChunkReference[],
  children: SessionContextChunkRecord[],
): boolean {
  return references.every(
    (reference, index) =>
      reference.chunk_id === children[index].chunk_id &&
      reference.range_start === children[index].range_start &&
      reference.range_end === children[index].range_end,
  );
}

function exactRollupDepth(
  chunk: SessionContextChunkRecord,
  children: SessionContextChunkRecord[],
): boolean {
  const childDepth = Math.max(...children.map((child) => child.depth ?? 0));
  return chunk.depth === childDepth + 1;
}
