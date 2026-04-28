import type { ChatEntry } from './state-readers.js';
import { tuiColors } from './theme.js';
import type { TranscriptRow } from './transcript-window.js';

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
  const lines = trimmed.split('\n');
  const firstLines = lines.slice(0, 3).join('\n');
  const remaining = lines.length - 3;
  return remaining > 0 ? `${firstLines}\n... ${remaining} more line(s)` : firstLines;
}

function lineItems(text: string): Array<{ key: string; text: string }> {
  return text.split('\n').map((line, index) => ({
    key: `${index}-${line}`,
    text: line,
  }));
}
