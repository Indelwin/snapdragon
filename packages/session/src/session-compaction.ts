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
  options: ContextWindowOptions;
  append: (chunk: ContextChunkInput) => SessionContextChunkRecord;
}): ContextCompactionResult {
  const chunks: SessionContextChunkRecord[] = [];
  let reason: string | undefined;
  const maxPasses = args.options.maxCompactionPasses ?? 16;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const plan = planContextCompaction(args, args.options);
    if (!plan.chunk) {
      reason = plan.reason;
      break;
    }
    const chunk = args.append(plan.chunk);
    chunks.push(chunk);
    args.chunks.push(chunk);
  }
  return { compacted: chunks.length > 0, chunks, reason };
}
