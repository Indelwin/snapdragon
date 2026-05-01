import type { ChatEntry } from './state-readers.js';
import { tuiColors } from './theme.js';
import { previewLines } from './transcript-preview.js';
import type { TranscriptRow } from './transcript-window.js';

const TOOL_PREVIEW_LINES = 3;
const TOOL_PREVIEW_CHARS = 2_000;

export function toolResultRows(entry: ChatEntry): TranscriptRow[] {
  const status = entry.toolStatus ?? (entry.isError ? 'error' : 'done');
  const color = entry.isError ? tuiColors.error : tuiColors.tool;
  return [
    { key: `${entry.id}-space`, kind: 'spacer' },
    {
      key: `${entry.id}-tool-top`,
      kind: 'line',
      prefix: '+ ',
      prefixColor: color,
      prefixBold: true,
      text: `${status} ${entry.toolName ?? 'tool'}`,
      color,
      bold: true,
    },
    ...lineItems(toolResultSummary(entry.content)).map((line) => ({
      key: `${entry.id}-tool-body-${line.key}`,
      kind: 'line' as const,
      prefix: '| ',
      prefixColor: color,
      text: line.text,
      color: entry.isError ? tuiColors.error : tuiColors.dim,
    })),
    {
      key: `${entry.id}-tool-bottom`,
      kind: 'line',
      prefix: '+ ',
      prefixColor: color,
      text: 'full output in events',
      color: tuiColors.muted,
    },
  ];
}

function toolResultSummary(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '(no output)';
  const { lines, truncated } = previewLines(trimmed, TOOL_PREVIEW_LINES, TOOL_PREVIEW_CHARS);
  return truncated ? `${lines.join('\n')}\n... full output in events` : lines.join('\n');
}

function lineItems(text: string): Array<{ key: string; text: string }> {
  return text.split('\n').map((line, index) => ({
    key: String(index),
    text: line,
  }));
}
