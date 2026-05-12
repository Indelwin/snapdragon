import type { RolloutTrace, ToolTraceStep } from './rollout.js';
import { stableStringify } from './stable-stringify.js';

export function consecutiveDuplicateToolIndexes(rollout: RolloutTrace): number[] {
  const duplicateIndexes: number[] = [];
  for (let index = 1; index < rollout.toolCalls.length; index += 1) {
    if (toolCallKey(rollout.toolCalls[index]) === toolCallKey(rollout.toolCalls[index - 1])) {
      duplicateIndexes.push(index);
    }
  }
  return duplicateIndexes;
}

export function repeatedFailedToolCalls(rollout: RolloutTrace): ToolTraceStep[] {
  const failed = new Set<string>();
  const repeats: ToolTraceStep[] = [];
  for (const call of rollout.toolCalls) {
    collectFailedRepeat(call, failed, repeats);
  }
  return repeats;
}

function collectFailedRepeat(
  call: ToolTraceStep,
  failed: Set<string>,
  repeats: ToolTraceStep[],
): void {
  if (call.success) return;
  const key = toolCallKey(call);
  if (failed.has(key)) repeats.push(call);
  failed.add(key);
}

function toolCallKey(call: ToolTraceStep): string {
  return `${call.name}:${stableStringify(call.input)}`;
}
