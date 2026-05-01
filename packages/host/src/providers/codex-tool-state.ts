import { asRecord, stringField } from './codex-record.js';

export function trackToolCallState(
  item: unknown,
  claimed: Set<string>,
  provided: Set<string>,
): void {
  const record = asRecord(item);
  if (!record) return;
  const callId = stringField(record, 'call_id');
  if (!callId) return;
  if (record.type === 'function_call') claimed.add(callId);
  if (record.type === 'function_call_output') provided.add(callId);
}
