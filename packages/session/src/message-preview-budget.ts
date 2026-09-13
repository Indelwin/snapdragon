import type { ReadMessagePreviewBatchOptions } from './message-preview-batch-types.js';

export function messagePreviewBudgetReached(
  startOffset: number,
  nextOffset: number,
  scannedRecords: number,
  options: ReadMessagePreviewBatchOptions,
): boolean {
  return (
    budgetReached(options.maxRecords, scannedRecords) ||
    budgetReached(options.maxBytes, nextOffset - startOffset)
  );
}

export function remainingPreviewBytes(limit: number | undefined, consumed: number): number {
  const normalized = normalizedBudget(limit);
  return normalized === undefined ? Number.POSITIVE_INFINITY : Math.max(0, normalized - consumed);
}

function budgetReached(limit: number | undefined, current: number): boolean {
  const normalized = normalizedBudget(limit);
  return normalized !== undefined && current >= normalized;
}

function normalizedBudget(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}
