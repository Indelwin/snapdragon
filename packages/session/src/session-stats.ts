import { parseMessagePreview } from './message-preview-parse.js';
import type { SessionMetadata } from './metadata.js';
import { hasRecordTypePrefix } from './record-envelope.js';
import { forEachRecordLine } from './record-line-reader.js';
import { parseRecord } from './records.js';

export interface SessionSummaryStats {
  metadata: SessionMetadata;
  openedAt?: number;
  lastMessageAt?: number;
  messageCount: number;
  visibleMessageCount: number;
  userMessageCount: number;
  toolCallCount: number;
  firstUserText?: string;
}

export function readSessionSummaryStats(path: string): SessionSummaryStats {
  const stats: SessionSummaryStats = {
    metadata: {},
    messageCount: 0,
    visibleMessageCount: 0,
    userMessageCount: 0,
    toolCallCount: 0,
  };
  forEachRecordLine(path, (line) => updateSummaryStats(stats, line), {
    maxLineChars: 128 * 1024,
    tailLineChars: 128 * 1024,
  });
  return stats;
}

function updateSummaryStats(stats: SessionSummaryStats, line: string): void {
  if (isMetadataLine(line)) {
    const record = parseRecord(line);
    if (record?.type === 'session_open') {
      stats.openedAt ??= record.created_at;
      if (record.meta) Object.assign(stats.metadata, record.meta);
    } else if (record?.type === 'session_meta') Object.assign(stats.metadata, record.meta);
    return;
  }
  const preview = parseMessagePreview(line, {
    includeContent: stats.firstUserText === undefined,
    includeToolCalls: true,
    maxContentChars: 512,
    maxArgsChars: 0,
    maxParseLineChars: 0,
  });
  if (!preview) return;
  stats.messageCount += 1;
  stats.lastMessageAt = preview.created_at;
  if (preview.role !== 'system') stats.visibleMessageCount += 1;
  if (preview.role === 'user') {
    stats.userMessageCount += 1;
    if (stats.firstUserText === undefined) stats.firstUserText = preview.contentText;
  }
  stats.toolCallCount += preview.tool_calls?.length ?? 0;
}

function isMetadataLine(line: string): boolean {
  return hasRecordTypePrefix(line, 'session_open') || hasRecordTypePrefix(line, 'session_meta');
}
