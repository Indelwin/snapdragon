import { Box, Text } from 'ink';
import type React from 'react';
import type { eventEntries } from '../state-readers.js';
import { trimText, tuiChars, tuiColors } from '../theme.js';

export function EventLogBox({ children }: { children: React.ReactNode }) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      borderStyle="round"
      borderColor={tuiColors.borderStrong}
      paddingX={1}
      marginRight={1}
      marginTop={1}
      overflow="hidden"
    >
      {children}
    </Box>
  );
}

export function EventLogHeader({ total }: { total: number }) {
  return (
    <Box flexDirection="row" marginBottom={1}>
      <Text color={tuiColors.accentSoft} bold>
        events
      </Text>
      <Text color={tuiColors.muted}>
        {' '}
        {tuiChars.dash} {total} total
      </Text>
    </Box>
  );
}

type EventEntry = ReturnType<typeof eventEntries>[number];

const MAX_DETAIL_LINES = 16;

export function EventEntryLine({ entry }: { entry: EventEntry }) {
  const detailLines = entry.detail ? entry.detail.trim().split('\n') : [];
  const visibleDetail = detailRows(detailLines.slice(0, MAX_DETAIL_LINES));
  const hidden = detailLines.length - visibleDetail.length;
  return (
    <Box flexDirection="column">
      <Text color={eventColor(entry.level, entry.source)}>
        {trimText(entry.source.padEnd(9).slice(0, 9), 9)}{' '}
        <Text color={tuiColors.muted}>{trimText(entry.message, 30)}</Text>
      </Text>
      {visibleDetail.map((line) => (
        <Text key={`${entry.id}-detail-${line.key}`} color={tuiColors.dim}>
          {'  '}
          {line.text}
        </Text>
      ))}
      {hidden > 0 ? <Text color={tuiColors.muted}> ... {hidden} more</Text> : null}
    </Box>
  );
}

function detailRows(lines: string[]): Array<{ key: string; text: string }> {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = line.slice(0, 48) || 'blank';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { key: `${base}-${count}`, text: line };
  });
}

function eventColor(level: string, source: string): string {
  if (level === 'error') return tuiColors.error;
  if (level === 'warn') return tuiColors.warn;
  if (source === 'tool') return tuiColors.tool;
  if (source === 'provider') return tuiColors.accentSoft;
  return tuiColors.dim;
}
