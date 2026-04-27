import type { ChatEntry } from './state-readers.js';
import { roleColor, tuiChars, tuiColors } from './theme.js';

export interface TranscriptRow {
  key: string;
  kind: 'line' | 'spacer';
  prefix?: string;
  prefixColor?: string;
  prefixBold?: boolean;
  text?: string;
  color?: string;
  bold?: boolean;
  cursor?: boolean;
}

export function transcriptRows(entries: readonly ChatEntry[]): TranscriptRow[] {
  return entries.flatMap((entry) => entryRows(entry));
}

export function visibleTranscriptRows(
  rows: readonly TranscriptRow[],
  viewportRows: number,
  scrollOffset: number,
): TranscriptRow[] {
  const capacity = Math.max(1, Math.floor(viewportRows));
  const maxOffset = Math.max(0, rows.length - capacity);
  const offset = Math.max(0, Math.min(maxOffset, Math.floor(scrollOffset)));
  const end = Math.max(0, rows.length - offset);
  return rows.slice(Math.max(0, end - capacity), end);
}

function entryRows(entry: ChatEntry): TranscriptRow[] {
  const rows: TranscriptRow[] = [{ key: `${entry.id}-space`, kind: 'spacer' }];
  rows.push(...thinkingRows(entry));
  rows.push(...contentRows(entry));
  if (entry.toolCalls) rows.push(toolCallsRow(entry));
  return rows;
}

function thinkingRows(entry: ChatEntry): TranscriptRow[] {
  if (!entry.thinking) return [];
  return splitLines(entry.thinking)
    .filter((line) => line.trim())
    .slice(-3)
    .map((line, index) => ({
      key: `${entry.id}-thinking-${index}-${line}`,
      kind: 'line',
      prefix: 'o ',
      prefixColor: tuiColors.thinking,
      text: line,
      color: tuiColors.thinking,
    }));
}

function contentRows(entry: ChatEntry): TranscriptRow[] {
  const content = entry.content || (entry.streaming ? '' : '(empty)');
  return lineItems(content).map((line) => ({
    key: `${entry.id}-content-${line.key}`,
    kind: 'line',
    prefix: line.first ? `${roleIcon(entry.role)} ` : '  ',
    prefixColor: roleColor(entry.role),
    prefixBold: line.first,
    text: line.text,
    color: entry.isError ? tuiColors.error : tuiColors.foreground,
    cursor: line.last && entry.streaming,
  }));
}

function toolCallsRow(entry: ChatEntry): TranscriptRow {
  return {
    key: `${entry.id}-tool-calls`,
    kind: 'line',
    prefix: '  ',
    text: `${tuiChars.bullet} ${entry.toolCalls} tool call(s)`,
    color: tuiColors.muted,
  };
}

function roleIcon(role: string): string {
  if (role === 'assistant') return '*';
  if (role === 'tool') return '>';
  if (role === 'error') return 'x';
  if (role === 'system') return '.';
  return '>';
}

function splitLines(text: string): string[] {
  return text.length > 0 ? text.split('\n') : [''];
}

function lineItems(text: string): Array<{
  key: string;
  text: string;
  first: boolean;
  last: boolean;
}> {
  const lines = splitLines(text);
  return lines.map((line, index) => ({
    key: `${index}-${line}`,
    text: line,
    first: index === 0,
    last: index === lines.length - 1,
  }));
}
