import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import Image, { TerminalInfoProvider } from 'ink-picture';
import { optionalStringValue, stringValue } from '../state-readers.js';
import { trimText, tuiChars, tuiColors } from '../theme.js';

export function SplashBanner({ component }: { component: UiComponentSnapshot }) {
  if (component.state.visible === false) return null;
  const imagePath = optionalStringValue(component.state.imagePath);
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
      {imagePath ? <SplashImage src={imagePath} /> : <SplashArt />}
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

function SplashImage({ src }: { src: string }) {
  // ink-picture's <Image> handles scaling, protocol selection, and
  // the ASCII fallback inline as a real Ink component. Forcing
  // `protocol="ascii"` gives us the chunky TUI-art look without
  // competing with iTerm/Kitty native graphics protocols (which
  // fight Ink's Yoga layout).
  //
  // The provider is scoped to just the splash so the rest of the
  // TUI doesn't pay the terminal-capability detection cost — and so
  // test environments without a real stdin don't get blocked waiting
  // for capability queries.
  return (
    <TerminalInfoProvider>
      <Image src={src} width={40} protocol="ascii" alt="splash" />
    </TerminalInfoProvider>
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
