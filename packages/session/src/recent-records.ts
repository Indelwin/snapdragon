import { existsSync, readFileSync } from 'node:fs';
import type { SessionMessageRecord } from './records.js';

export interface RecentMessageRecords {
  records: SessionMessageRecord[];
  totalMessages: number;
}

export function readRecentMessageRecords(path: string, limit: number): RecentMessageRecords {
  const state = { records: [] as SessionMessageRecord[], totalMessages: 0 };
  const bounded = Math.max(0, Math.floor(limit));
  forEachLine(path, (line) => collectRecentMessage(state, line, bounded));
  return state;
}

function collectRecentMessage(state: RecentMessageRecords, line: string, bounded: number): void {
  const record = isMessageLine(line) ? parseMessageRecord(line) : undefined;
  if (!record) return;
  state.totalMessages += 1;
  if (bounded === 0) return;
  if (state.records.length === bounded) state.records.shift();
  state.records.push(record);
}

function parseMessageRecord(line: string): SessionMessageRecord | undefined {
  try {
    const record = JSON.parse(line) as SessionMessageRecord;
    return record.type === 'message' ? record : undefined;
  } catch {
    return undefined;
  }
}

function forEachLine(path: string, visit: (line: string) => void): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  let start = 0;
  while (start < text.length) start = visitNextLine(text, start, visit);
}

function visitNextLine(text: string, start: number, visit: (line: string) => void): number {
  const newline = text.indexOf('\n', start);
  const end = newline === -1 ? text.length : newline;
  const line = text.slice(start, end).trim();
  if (line) visit(line);
  return end + 1;
}

function isMessageLine(line: string): boolean {
  return line.includes('"type":"message"') || line.includes('"type": "message"');
}
