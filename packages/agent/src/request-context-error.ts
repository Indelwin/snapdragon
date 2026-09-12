import { maxContextPressure } from './request-context-budget.js';

export class ContextBudgetExceededError extends Error {
  readonly code = 'CONTEXT_BUDGET_EXCEEDED';
  readonly estimatedTokens: number;
  readonly maxRequestTokens: number;

  constructor(estimatedTokens: number, maxRequestTokens: number) {
    super(
      `Context cannot fit maxRequestTokens=${maxRequestTokens} after compaction ` +
        `(estimated ${estimatedTokens} tokens). Reduce fixed prompt/tool input or increase the context budget.`,
    );
    this.name = 'ContextBudgetExceededError';
    this.estimatedTokens = estimatedTokens;
    this.maxRequestTokens = maxRequestTokens;
  }
}

export function isContextBudgetExceededError(error: unknown): error is ContextBudgetExceededError {
  return error instanceof ContextBudgetExceededError;
}

export function isContextWindowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /context window|input exceeds|maximum context|too many input tokens/i.test(message);
}

export function shouldRetryContextWindow(error: unknown, pressure: number): boolean {
  if (isContextBudgetExceededError(error)) return false;
  if (pressure >= maxContextPressure()) return false;
  return isContextWindowError(error);
}
