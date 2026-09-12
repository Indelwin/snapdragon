import { hasRecordTypePrefix } from './record-envelope.js';
import type { SessionMessageRecord } from './records.js';

export function parseRecentMessageRecord(line: string): SessionMessageRecord | undefined {
  if (!isMessageLine(line)) return undefined;
  try {
    const record = JSON.parse(line) as SessionMessageRecord;
    return record.type === 'message' ? record : undefined;
  } catch {
    return undefined;
  }
}

function isMessageLine(line: string): boolean {
  return hasRecordTypePrefix(line, 'message');
}
