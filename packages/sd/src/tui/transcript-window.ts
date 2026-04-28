import type { ChatEntry } from './state-readers.js';
import { roleColor, tuiChars, tuiColors } from './theme.js';
import { toolResultRows } from './transcript-tool-rows.js';

export { wrapTranscriptRows } from './transcript-wrap.js';

export interface TranscriptRow {
  key: string;
  kind: 'line' | 'spacer';
  prefix?: string;
  prefixColor?: string;
  prefixBold?: boolean;
  text?: string;
  role?: string;
  color?: string;
  bold?: boolean;
  markdown?: boolean;
  codeBlock?: boolean;
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
  if (entry.role === 'tool') return toolResultRows(entry);
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
      key: `${entry.id}-thinking-${index}`,
      kind: 'line',
      prefix: 'o ',
      prefixColor: tuiColors.thinking,
      text: line,
      color: tuiColors.thinking,
    }));
}

function contentRows(entry: ChatEntry): TranscriptRow[] {
  if (!entry.content && entry.role === 'assistant' && entry.toolCalls) return [];
  const content = entry.content || (entry.streaming ? '' : '(empty)');
  return lineItems(content).map((line) => ({
    key: `${entry.id}-content-${line.key}`,
    kind: 'line',
    prefix: line.first ? `${roleIcon(entry.role)} ` : '  ',
    prefixColor: roleColor(entry.role),
    prefixBold: line.first,
    text: line.text,
    role: entry.role,
    color: entry.isError ? tuiColors.error : tuiColors.foreground,
    markdown: entry.role === 'assistant',
    codeBlock: line.codeBlock,
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
  codeBlock: boolean;
}> {
  const lines = splitLines(text);
  let inCodeBlock = false;
  return lines.map((line, index) => {
    const fence = /^\s*```/.test(line);
    const codeBlock = inCodeBlock || fence;
    if (fence) inCodeBlock = !inCodeBlock;
    return {
      key: String(index),
      text: line,
      first: index === 0,
      last: index === lines.length - 1,
      codeBlock,
    };
  });
}
