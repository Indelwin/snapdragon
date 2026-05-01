import type { Message, ToolDefinition } from '@snapdragon-ai/host';
import {
  DEFAULT_CONTEXT_WINDOW_OPTIONS,
  estimateMessagesTokens,
  HeuristicTokenCounter,
} from '@snapdragon-ai/session';
import type { AgentContextOptions } from './types.js';

const MAX_PREFLIGHT_COMPACTION_PASSES = 96;
const PRESSURE_BUDGET_FACTORS = [1, 0.85, 0.7, 0.55] as const;

export function estimateRequestTokens(messages: Message[], tools: ToolDefinition[]): number {
  const counter = new HeuristicTokenCounter();
  const toolTokens = tools.length === 0 ? 0 : counter.countString(JSON.stringify(tools));
  return estimateMessagesTokens(messages, counter) + toolTokens;
}

export function requestBudget(context: AgentContextOptions, pressure = 0): number | undefined {
  const max = positiveInteger(context.maxRequestTokens);
  if (max === undefined) return undefined;
  const index = Math.min(pressure, PRESSURE_BUDGET_FACTORS.length - 1);
  return Math.max(1, Math.floor(max * PRESSURE_BUDGET_FACTORS[index]));
}

export function tailCandidates(freshTailCount: number | undefined, pressure = 0): number[] {
  const start = initialTailCount(freshTailCount);
  const out: number[] = [];
  let current = Math.max(1, Math.floor(start / 2 ** pressure));
  while (current > 1) {
    out.push(current);
    current = Math.max(1, Math.floor(current / 2));
  }
  out.push(1);
  return [...new Set(out)];
}

export function contextOptions(
  context: AgentContextOptions,
  freshTailCount: number,
): AgentContextOptions {
  return {
    ...context,
    freshTailCount,
    minChunkMessages: 1,
    maxCompactionPasses: Math.max(
      positiveInteger(context.maxCompactionPasses) ?? 0,
      MAX_PREFLIGHT_COMPACTION_PASSES,
    ),
  };
}

export function maxContextPressure(): number {
  return PRESSURE_BUDGET_FACTORS.length - 1;
}

function initialTailCount(freshTailCount: number | undefined): number {
  const fallback = DEFAULT_CONTEXT_WINDOW_OPTIONS.freshTailCount;
  return Math.max(1, positiveInteger(freshTailCount) ?? fallback);
}

function positiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}
