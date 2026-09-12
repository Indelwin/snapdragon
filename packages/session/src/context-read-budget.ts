export const CONTEXT_RECORD_BYTES = 1_048_576;
export const CONTEXT_STATE_BYTES = 8 * CONTEXT_RECORD_BYTES;
export const CONTEXT_BATCH_BYTES = 4 * CONTEXT_RECORD_BYTES;
export const CONTEXT_STATE_RECORDS = 16_384;

export class ContextReadBudgetExceededError extends Error {
  readonly code = 'CONTEXT_READ_BUDGET_EXCEEDED';

  constructor(
    readonly scope: 'record' | 'messages' | 'frontier',
    readonly limit: number,
    readonly storeId?: number,
  ) {
    super(
      `Session context ${scope} exceeds the bounded read limit (${limit}). ` +
        'The canonical archive is preserved; compact older messages or reduce the protected context before retrying.',
    );
    this.name = 'ContextReadBudgetExceededError';
  }
}
