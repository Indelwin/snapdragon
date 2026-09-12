import type { SessionMetadata } from './metadata.js';
import { hasRecordTypePrefix } from './record-envelope.js';
import { forEachRecordLine } from './record-line-reader.js';
import type { SessionMetaRecord, SessionOpenRecord } from './records.js';

export function readSessionMetadata(path: string): SessionMetadata {
  const metadata: SessionMetadata = {};
  forEachRecordLine(
    path,
    (line) => {
      if (!isMetadataLine(line)) return;
      const record = parseMetadataRecord(line);
      if (record?.type === 'session_open' && record.meta) Object.assign(metadata, record.meta);
      if (record?.type === 'session_meta') Object.assign(metadata, record.meta);
    },
    { maxLineChars: 1_048_576 },
  );
  return metadata;
}

export function readMetadataRecords(path: string): Array<SessionOpenRecord | SessionMetaRecord> {
  const out: Array<SessionOpenRecord | SessionMetaRecord> = [];
  forEachRecordLine(
    path,
    (line) => {
      if (!isMetadataLine(line)) return;
      const record = parseMetadataRecord(line);
      if (record) out.push(record);
    },
    { maxLineChars: 1_048_576 },
  );
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

function isMetadataLine(line: string): boolean {
  return isTypeLine(line, 'session_open') || isTypeLine(line, 'session_meta');
}

function isTypeLine(line: string, type: string): boolean {
  return hasRecordTypePrefix(line, type);
}
