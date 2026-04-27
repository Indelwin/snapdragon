import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { eventEntries, toolEntries } from '../state-readers.js';
import { trimText, tuiChars, tuiColors } from '../theme.js';

export function ToolPanel({ component }: { component: UiComponentSnapshot }) {
  const tools = toolEntries(component.state).slice(-10);
  if (component.state.open === false || tools.length === 0) return null;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={tuiColors.borderStrong}
      paddingX={1}
      marginRight={1}
    >
      <Text color={tuiColors.accentSoft} bold>
        tools
      </Text>
      {tools.map((tool) => (
        <Text key={tool.id} color={tool.status === 'error' ? tuiColors.error : tuiColors.tool}>
          {tool.status} {tool.name}
        </Text>
      ))}
    </Box>
  );
}

export function EventLog({ component }: { component: UiComponentSnapshot }) {
  const entries = eventEntries(component.state).slice(-18);
  if (component.state.open === false) return null;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={tuiColors.borderStrong}
      paddingX={1}
      marginRight={1}
      marginTop={1}
    >
      <Box flexDirection="row" marginBottom={1}>
        <Text color={tuiColors.accentSoft} bold>
          events
        </Text>
        <Text color={tuiColors.muted}>
          {' '}
          {tuiChars.dash} {entries.length} total
        </Text>
      </Box>
      {entries.length === 0 ? <Text color={tuiColors.muted}>(nothing yet)</Text> : null}
      {entries.map((entry) => (
        <Text key={entry.id} color={eventColor(entry.level, entry.source)}>
          {trimText(entry.source.padEnd(9).slice(0, 9), 9)}{' '}
          <Text color={tuiColors.muted}>{trimText(entry.message, 30)}</Text>
        </Text>
      ))}
    </Box>
  );
}

function eventColor(level: string, source: string): string {
  if (level === 'error') return tuiColors.error;
  if (level === 'warn') return tuiColors.warn;
  if (source === 'tool') return tuiColors.tool;
  if (source === 'provider') return tuiColors.accentSoft;
  return tuiColors.dim;
}
