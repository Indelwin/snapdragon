import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { chatEntries } from '../state-readers.js';
import { tuiChars, tuiColors } from '../theme.js';
import {
  type TranscriptRow,
  transcriptRows,
  visibleTranscriptRows,
  wrapTranscriptRows,
} from '../transcript-window.js';
import { MarkdownLine } from './markdown.js';

export function ChatTranscript({
  component,
  viewportRows = 18,
  viewportColumns,
}: {
  component: UiComponentSnapshot;
  viewportRows?: number;
  viewportColumns: number;
}) {
  const entries = chatEntries(component.state);
  if (entries.length === 0) return <EmptyTranscript />;
  const rows = wrapTranscriptRows(transcriptRows(entries), viewportColumns - 2);
  const visibleRows = visibleTranscriptRows(
    rows,
    viewportRows,
    typeof component.state.scrollOffset === 'number' ? component.state.scrollOffset : 0,
  );
  return (
    <Box flexDirection="column" paddingX={1} height={viewportRows} overflow="hidden">
      {visibleRows.map((row) => (
        <TranscriptLine key={row.key} row={row} />
      ))}
    </Box>
  );
}

function EmptyTranscript() {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color={tuiColors.dim}>Welcome. Type a message and press enter to start.</Text>
      <Text color={tuiColors.muted}>
        Your first message will run against the configured provider.
      </Text>
    </Box>
  );
}

function TranscriptLine({ row }: { row: TranscriptRow }) {
  if (row.kind === 'spacer') return <Text> </Text>;
  return (
    <Text color={row.color} bold={row.bold}>
      <Text color={row.prefixColor ?? row.color} bold={row.prefixBold}>
        {row.prefix}
      </Text>
      {row.markdown ? (
        <MarkdownLine text={row.text ?? ''} color={row.color} codeBlock={row.codeBlock} />
      ) : (
        (row.text ?? '')
      )}
      {row.cursor ? <Text color={tuiColors.accentSoft}>{tuiChars.cursor}</Text> : null}
    </Text>
  );
}
