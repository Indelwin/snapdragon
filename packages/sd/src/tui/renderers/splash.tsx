import type { JsonObject, UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { numberValue, optionalStringValue, stringValue } from '../state-readers.js';
import { trimText, tuiChars, tuiColors } from '../theme.js';
import { AsciiTitle } from './ascii-title.js';
import { ColoredBrailleImage } from './colored-braille.js';

// Pink → lilac vertical gradient for the splash title. Top stop is
// the SD accent pink so the title sits visually adjacent to the
// dragon's shimmer; bottom stop is the existing `thinking` lilac
// from the theme so we're reusing palette colours rather than
// inventing new ones.
const SPLASH_TITLE_GRADIENT = [tuiColors.accent, tuiColors.thinking] as const;

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
      <Box flexDirection="row">
        {imagePath ? <SplashImage src={imagePath} /> : <SplashArt />}
        <SplashStats stats={(component.state.stats as JsonObject | undefined) ?? {}} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <AsciiTitle
          text={stringValue(component.state.title) || 'snapdragon'}
          font="Slant"
          colors={SPLASH_TITLE_GRADIENT}
        />
        <Text color={tuiColors.muted}>
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

/**
 * Right-side stats panel. Reads a `stats` object out of the splash
 * state (computed by `runtimeStats` in the controller) and renders
 * a compact dashboard. Counts are right-padded so the column reads
 * cleanly even with single- or three-digit numbers.
 */
function SplashStats({ stats }: { stats: JsonObject }) {
  const tools = numberValue(stats.tools);
  const skills = numberValue(stats.skills);
  const profiles = numberValue(stats.profiles);
  const services = numberValue(stats.services);
  const extensions = numberValue(stats.extensions);
  const reasoning = optionalStringValue(stats.reasoning);
  const contextTokens = numberValue(stats.contextTokens);
  const outputTokens = numberValue(stats.outputTokens);
  return (
    <Box flexDirection="column" paddingLeft={3}>
      <StatRow label="tools" value={tools} />
      <StatRow label="skills" value={skills} />
      <StatRow label="profiles" value={profiles} />
      <StatRow label="services" value={services} />
      <StatRow label="extensions" value={extensions} />
      <Box marginTop={1} flexDirection="column">
        <StatRow label="reasoning" value={reasoning ?? '—'} />
        <StatRow label="context" value={contextTokens ? formatTokenCount(contextTokens) : '—'} />
        <StatRow label="output" value={outputTokens ? formatTokenCount(outputTokens) : '—'} />
      </Box>
    </Box>
  );
}

function StatRow({ label, value }: { label: string; value: number | string | undefined }) {
  const display = value === undefined ? '—' : String(value);
  // Pad the label column to a fixed width so the value column lines
  // up across rows. Values are right-aligned in their own narrow
  // column so digit counts don't make the layout jitter.
  return (
    <Box flexDirection="row">
      <Box width={11}>
        <Text color={tuiColors.dim}>{label}</Text>
      </Box>
      <Box width={6} justifyContent="flex-end">
        <Text color={tuiColors.accentSoft} bold>
          {display}
        </Text>
      </Box>
    </Box>
  );
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
