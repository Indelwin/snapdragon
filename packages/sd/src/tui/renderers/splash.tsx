import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { optionalStringValue, stringValue } from '../state-readers.js';
import { trimText, tuiChars, tuiColors } from '../theme.js';
import { ColoredBrailleImage } from './colored-braille.js';

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

// 50×25 cells. Each braille glyph packs 2×4 dots, so the renderer
// samples a 100×100 pixel slice of the source — high enough to keep
// the dragon's outlines and flowers recognisable, low enough to fit
// neatly inside the splash box on a typical 80–120 column terminal.
const SPLASH_IMAGE_WIDTH = 50;
const SPLASH_IMAGE_HEIGHT = 25;

function SplashImage({ src }: { src: string }) {
  // We render the splash via our own colour-tinted braille component
  // rather than `ink-picture`'s `BrailleImage` so the whole image can
  // pick up the SD theme. `tuiColors.accentSoft` (the splash banner's
  // existing accent) tints the glyphs without overpowering the
  // surrounding chrome.
  return (
    <Box width={SPLASH_IMAGE_WIDTH} height={SPLASH_IMAGE_HEIGHT} flexShrink={0}>
      <ColoredBrailleImage
        src={src}
        width={SPLASH_IMAGE_WIDTH}
        height={SPLASH_IMAGE_HEIGHT}
        shimmer
        shimmerColor={tuiColors.accent}
        alt="loading splash…"
      />
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
