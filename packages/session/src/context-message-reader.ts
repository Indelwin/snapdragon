import {
  CONTEXT_RECORD_BYTES,
  CONTEXT_STATE_BYTES,
  CONTEXT_STATE_RECORDS,
  ContextReadBudgetExceededError,
} from './context-read-budget.js';
import { recordIdFromPrefix } from './record-envelope.js';
import { forEachRecordLine } from './record-line-reader.js';
import { parseRecord, type SessionMessageRecord } from './records.js';

export function forEachContextMessage(
  path: string,
  watermark: number,
  visit: (record: SessionMessageRecord, bytes: number) => void,
): void {
  forEachRecordLine(
    path,
    (line, truncated) => {
      const id = recordIdFromPrefix(line, 'message', 'store_id');
      if (id !== undefined && id <= watermark) return;
      if (truncated) {
        if (id !== undefined || line.endsWith('}')) {
          throw new ContextReadBudgetExceededError('record', CONTEXT_RECORD_BYTES, id);
        }
        return;
      }
      const record = parseRecord(line);
      if (record?.type !== 'message' || record.store_id <= watermark) return;
      const bytes = Buffer.byteLength(line);
      if (bytes > CONTEXT_RECORD_BYTES) {
        throw new ContextReadBudgetExceededError('record', CONTEXT_RECORD_BYTES, record.store_id);
      }
      visit(record, bytes);
    },
    { maxLineChars: CONTEXT_RECORD_BYTES, tailLineChars: 1 },
  );
}

export function readContextMessages(path: string, watermark: number): SessionMessageRecord[] {
  const messages: SessionMessageRecord[] = [];
  let bytes = 0;
  forEachContextMessage(path, watermark, (record, size) => {
    bytes += size;
    if (bytes > CONTEXT_STATE_BYTES || messages.length >= CONTEXT_STATE_RECORDS) {
      throw new ContextReadBudgetExceededError('messages', CONTEXT_STATE_BYTES, record.store_id);
    }
    messages.push(record);
  });
  return messages;
}
