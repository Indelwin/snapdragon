import { Text } from 'ink';
import type { ReactNode } from 'react';
import { tuiColors } from '../theme.js';

interface MarkdownLineProps {
  text: string;
  color?: string;
  codeBlock?: boolean;
}

interface InlineSpan {
  text: string;
  kind: 'text' | 'bold' | 'code';
}

export function MarkdownLine({ text, color, codeBlock }: MarkdownLineProps) {
  const line = normalizeLine(text, codeBlock === true);
  if (line.codeBlock) {
    return <Text color={tuiColors.muted}>{line.text}</Text>;
  }
  return (
    <Text color={line.color ?? color} bold={line.bold}>
      {inlineSpans(line.text).map((span, index) => renderSpan(span, index, color))}
    </Text>
  );
}

function normalizeLine(
  text: string,
  codeBlock: boolean,
): {
  text: string;
  bold?: boolean;
  color?: string;
  codeBlock?: boolean;
} {
  if (codeBlock) return { text, codeBlock: true };
  const heading = /^(#{1,6})\s+(.+)$/.exec(text);
  if (heading) return { text: heading[2], bold: true, color: tuiColors.accentSoft };
  const quote = /^>\s?(.*)$/.exec(text);
  if (quote) return { text: `> ${quote[1]}`, color: tuiColors.muted };
  return { text };
}

function inlineSpans(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let index = 0;
  while (index < text.length) {
    const next = nextToken(text, index);
    if (!next) {
      spans.push({ text: text.slice(index), kind: 'text' });
      break;
    }
    if (next.start > index) spans.push({ text: text.slice(index, next.start), kind: 'text' });
    spans.push(next.span);
    index = next.end;
  }
  return spans.filter((span) => span.text.length > 0);
}

function nextToken(
  text: string,
  from: number,
): { start: number; end: number; span: InlineSpan } | undefined {
  const code = tokenBetween(text, from, '`', '`', 'code');
  const bold = tokenBetween(text, from, '**', '**', 'bold');
  if (!code) return bold;
  if (!bold) return code;
  return code.start <= bold.start ? code : bold;
}

function tokenBetween(
  text: string,
  from: number,
  open: string,
  close: string,
  kind: InlineSpan['kind'],
): { start: number; end: number; span: InlineSpan } | undefined {
  const start = text.indexOf(open, from);
  if (start < 0) return undefined;
  const bodyStart = start + open.length;
  const end = text.indexOf(close, bodyStart);
  if (end < 0) return undefined;
  return {
    start,
    end: end + close.length,
    span: { text: text.slice(bodyStart, end), kind },
  };
}

function renderSpan(span: InlineSpan, index: number, color?: string): ReactNode {
  if (span.kind === 'bold') {
    return (
      <Text key={index} color={color} bold>
        {span.text}
      </Text>
    );
  }
  if (span.kind === 'code') {
    return (
      <Text key={index} color={tuiColors.accentSoft}>
        {span.text}
      </Text>
    );
  }
  return <Text key={index}>{span.text}</Text>;
}
