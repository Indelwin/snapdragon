import { asRecord, stringField } from './codex-record.js';

const MISSING_TOOL_OUTPUT_STUB = '[unknown error, tool output missing]';

export function appendRepairedToolItem(
  item: unknown,
  claimed: Set<string>,
  provided: Set<string>,
  out: unknown[],
): void {
  const record = asRecord(item);
  if (!record) {
    out.push(item);
    return;
  }

  const callId = stringField(record, 'call_id');
  if (record.type === 'function_call_output') {
    if (callId && claimed.has(callId)) out.push(item);
    return;
  }

  out.push(item);
  if (record.type !== 'function_call') return;
  if (!callId) return;
  if (provided.has(callId)) return;
  out.push({ type: 'function_call_output', call_id: callId, output: MISSING_TOOL_OUTPUT_STUB });
}
