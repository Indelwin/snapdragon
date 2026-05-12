import { existsSync, readFileSync } from 'node:fs';
import type { SessionMetaRecord, SessionOpenRecord } from './records.js';

export function readMetadataRecords(path: string): Array<SessionOpenRecord | SessionMetaRecord> {
  const out: Array<SessionOpenRecord | SessionMetaRecord> = [];
  forEachLine(path, (line) => {
    if (!isMetadataLine(line)) return;
    const record = parseMetadataRecord(line);
    if (record) out.push(record);
  });
  return out;
}

function parseMetadataRecord(line: string): SessionOpenRecord | SessionMetaRecord | undefined {
  try {
    const record = JSON.parse(line) as SessionOpenRecord | SessionMetaRecord;
    return isMetadataRecord(record) ? record : undefined;
  } catch {
    return undefined;
  }
}

function isMetadataRecord(
  record: SessionOpenRecord | SessionMetaRecord,
): record is SessionOpenRecord | SessionMetaRecord {
  return record.type === 'session_open' || record.type === 'session_meta';
}

function forEachLine(path: string, visit: (line: string) => void): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    const line = text.slice(start, end).trim();
    if (line) visit(line);
    start = end + 1;
  }
}

function isMetadataLine(line: string): boolean {
  return isTypeLine(line, 'session_open') || isTypeLine(line, 'session_meta');
}

function isTypeLine(line: string, type: string): boolean {
  return line.includes(`"type":"${type}"`) || line.includes(`"type": "${type}"`);
}
