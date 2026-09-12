import { existsSync } from 'node:fs';
import { readTailMessages } from './recent-tail-reader.js';
import { readRecordStats, type SessionMessageRecord } from './records.js';

export interface RecentMessageRecords {
  records: SessionMessageRecord[];
  totalMessages: number;
  oversizedLines: number;
}

export function readRecentMessageRecords(path: string, limit: number): RecentMessageRecords {
  const bounded = Math.max(0, Math.floor(limit));
  const totalMessages = readRecordStats(path).messageCount;
  if (bounded === 0 || !existsSync(path)) return { records: [], totalMessages, oversizedLines: 0 };
  return { ...readTailMessages(path, bounded), totalMessages };
}
