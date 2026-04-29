import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { optionalStringValue, stringValue } from '../state-readers.js';
import { trimText, tuiChars, tuiColors } from '../theme.js';

export function SplashBanner({ component }: { component: UiComponentSnapshot }) {
  if (component.state.visible === false) return null;
  const image = optionalStringValue(component.state.image);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={tuiColors.borderAccent}
      paddingX={2}
      paddingY={1}
      marginX={1}
      marginY={1}
    >
      {image ? <SplashImage image={image} /> : <SplashArt />}
      <Box marginTop={1} flexDirection="row">
        <Text color={tuiColors.accent} bold>
          {stringValue(component.state.title).toUpperCase() || 'SNAPDRAGON'}
        </Text>
        <Text color={tuiColors.muted}>
          {' '}
          {tuiChars.bullet} {stringValue(component.state.subtitle) || 'Ready for a workspace task'}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="row" flexWrap="wrap">
        <Text color={tuiColors.dim}>provider: </Text>
        <Text color={tuiColors.accentSoft} bold>
          {stringValue(component.state.provider) || 'unknown'}
        </Text>
        <Text color={tuiColors.dim}> {tuiChars.bullet} model: </Text>
        <Text color={tuiColors.accentSoft} bold>
          {stringValue(component.state.model) || 'unknown'}
        </Text>
        <Text color={tuiColors.dim}> {tuiChars.bullet} profile: </Text>
        <Text color={tuiColors.accentSoft} bold>
          {stringValue(component.state.profile) || 'none'}
        </Text>
      </Box>
      <Text color={tuiColors.muted}>
        workspace {tuiChars.dash} {trimText(stringValue(component.state.cwd), 96)}
      </Text>
      <Box marginTop={1}>
        <Text color={tuiColors.muted}>type /help or press ctrl-p for commands</Text>
      </Box>
    </Box>
  );
}

function SplashImage({ image }: { image: string }) {
  // `terminal-image` returns a multi-line string where each line is
  // pre-coloured with ANSI escapes for the upper/lower half-block
  // pixel pair. Splitting on newline and rendering one <Text> per
  // line lets Ink lay it out cleanly. Position-based keys are
  // intentional and stable for the fixed-length rendered string.
  const lines = image.split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional key is stable for fixed-length rendered splash
        <Text key={index}>{line}</Text>
      ))}
    </Box>
  );
}

function SplashArt() {
  return (
    <Box flexDirection="column">
      {[
        '      /\\\\__/\\\\',
        '     (  o  o )',
        '      >  --  >----------.-.',
        '     /        \\\\        ( @ )',
        "    /_/|/\\\\/\\\\|\\\\_\\\\      `-'",
      ].map((line, index) => (
        <Text key={line} color={splashLineColor(index)} bold={index === 2}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

function splashLineColor(index: number): string {
  if (index === 2) return tuiColors.accent;
  if (index === 4) return tuiColors.accentPale;
  return tuiColors.accentSoft;
}
