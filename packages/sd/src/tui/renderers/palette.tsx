import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { commandEntries, numberValue, stringValue } from '../state-readers.js';
import { tuiChars, tuiColors } from '../theme.js';

export function CommandPalette({ component }: { component: UiComponentSnapshot }) {
  if (component.state.open !== true) return null;
  const query = stringValue(component.state.query);
  const selectedIndex = numberValue(component.state.selectedIndex) ?? 0;
  const commands = commandEntries(component.state).filter((command) => {
    if (!query.trim()) return true;
    return `${command.name} ${command.description}`.toLowerCase().includes(query.toLowerCase());
  });
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={tuiColors.accent}
      paddingX={1}
      width={52}
      marginY={1}
      marginX={1}
    >
      <Text color={tuiColors.accent} bold>
        command palette
      </Text>
      <Text color={tuiColors.foreground}>
        {tuiChars.prompt} {query}
        <Text color={tuiColors.accentSoft}>{tuiChars.cursor}</Text>
      </Text>
      {commands.length === 0 ? <Text color={tuiColors.muted}>No commands</Text> : null}
      {commands.slice(0, 10).map((command, index) => (
        <Text key={command.name} color={index === selectedIndex ? tuiColors.accent : undefined}>
          {index === selectedIndex ? `${tuiChars.pointer} ` : '  '}
          {command.name}
          {command.argHint ? ` ${command.argHint}` : ''} {tuiChars.dash} {command.description}
        </Text>
      ))}
      <Text color={tuiColors.muted}>
        enter run {tuiChars.bullet} esc close {tuiChars.bullet} up/down select
      </Text>
    </Box>
  );
}
