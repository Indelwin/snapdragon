import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { keybindEntries } from '../state-readers.js';
import { tuiColors } from '../theme.js';

export function KeybindBar({ component }: { component: UiComponentSnapshot }) {
  return (
    <Box flexDirection="row" height={1} overflow="hidden" paddingX={1}>
      {keybindEntries(component.state).map((bind) => (
        <Box key={bind.keys} flexShrink={0}>
          <Text color={tuiColors.muted}>
            <Text color={tuiColors.accent}>{bind.keys}</Text> {bind.label}
            {'  '}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
