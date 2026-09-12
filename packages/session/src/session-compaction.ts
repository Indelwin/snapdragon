import {
  activeContextChunks,
  applyContextChunk,
  createContextFrontier,
  sortedActiveChunks,
} from './context-frontier.js';
import type { ContextWindowOptions } from './context-options.js';
import type { ContextChunkInput } from './context-summary.js';
import { planContextCompaction } from './context-window.js';
import type { SessionContextChunkRecord, SessionMessageRecord } from './records.js';

export interface ContextCompactionResult {
  compacted: boolean;
  chunks: SessionContextChunkRecord[];
  reason?: string;
}

export function compactSessionContext(args: {
  messages: SessionMessageRecord[];
  chunks: SessionContextChunkRecord[];
  activeChunks?: boolean;
  options: ContextWindowOptions;
  append: (chunk: ContextChunkInput) => SessionContextChunkRecord;
}): ContextCompactionResult {
  const chunks: SessionContextChunkRecord[] = [];
  const frontier = createContextFrontier();
  for (const chunk of args.activeChunks ? args.chunks : activeContextChunks(args.chunks)) {
    frontier.active.set(chunk.chunk_id, chunk);
    frontier.maxChunkId = Math.max(frontier.maxChunkId, chunk.chunk_id);
  }
  let reason: string | undefined;
  const maxPasses = args.options.maxCompactionPasses ?? 16;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const plan = planContextCompaction(
      { ...args, chunks: sortedActiveChunks(frontier), activeChunks: true },
      args.options,
    );
    if (!plan.chunk) {
      reason = plan.reason;
      break;
    }
    const chunk = args.append(plan.chunk);
    chunks.push(chunk);
    applyContextChunk(frontier, chunk);
  }
  return { compacted: chunks.length > 0, chunks, reason };
}
