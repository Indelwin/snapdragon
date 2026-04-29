import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { AsciiImage, type TerminalInfo, TerminalInfoContext } from 'ink-picture';
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

const SPLASH_IMAGE_WIDTH = 40;
const SPLASH_IMAGE_HEIGHT = 20;

// We bypass `ink-picture`'s `TerminalInfoProvider` because its
// terminal-capability probes (OSC queries written to stdout, responses
// read from stdin) race with Ink's own input handler — when the
// provider mounts after the prompt is accepting keystrokes, the
// response bytes leak into the input buffer (we saw real escape
// sequences land in `> ` after the splash mounted). For the splash we
// only ever want the ASCII renderer with colour, so a hard-coded
// context is enough: it skips the probing entirely and still satisfies
// `AsciiImage`'s `useTerminalInfo()` requirement (which throws after
// 2s if no context is found). The dimensions are arbitrary plausible
// values — `AsciiImage` doesn't consult them, only the half-block /
// graphics-protocol renderers do.
const SPLASH_TERMINAL_INFO: TerminalInfo = {
  dimensions: { viewportWidth: 1024, viewportHeight: 768, cellWidth: 8, cellHeight: 16 },
  capabilities: {
    supportsUnicode: true,
    supportsColor: true,
    supportsSixelGraphics: false,
    supportsKittyGraphics: false,
    supportsITerm2Graphics: false,
  },
};

function SplashImage({ src }: { src: string }) {
  // The outer fixed-size Box gives Yoga a definite container before
  // `AsciiImage` runs `measureElement` — without it the renderer sees
  // a near-zero container on first render and clamps the image down
  // to a couple of cells.
  return (
    <TerminalInfoContext.Provider value={SPLASH_TERMINAL_INFO}>
      <Box width={SPLASH_IMAGE_WIDTH} height={SPLASH_IMAGE_HEIGHT} flexShrink={0}>
        <AsciiImage
          src={src}
          width={SPLASH_IMAGE_WIDTH}
          height={SPLASH_IMAGE_HEIGHT}
          alt="splash"
          onSupportDetected={() => {}}
        />
      </Box>
    </TerminalInfoContext.Provider>
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
