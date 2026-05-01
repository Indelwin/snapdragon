import { maxContextPressure } from './request-context-budget.js';

export function isContextWindowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /context window|input exceeds|maximum context|too many input tokens/i.test(message);
}

export function shouldRetryContextWindow(error: unknown, pressure: number): boolean {
  if (pressure >= maxContextPressure()) return false;
  return isContextWindowError(error);
}
