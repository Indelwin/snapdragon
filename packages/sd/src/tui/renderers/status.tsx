import type { UiComponentSnapshot, UiWorldSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { numberValue, objectValue, stringValue } from '../state-readers.js';
import { tuiChars, tuiColors } from '../theme.js';
import { SD_UI_IDS } from '../ui.js';

export function SessionStatus({
  component,
  snapshot,
}: {
  component: UiComponentSnapshot;
  snapshot: UiWorldSnapshot;
}) {
  const state = component.state;
  const runState = snapshot.components[SD_UI_IDS.runStatus]?.state ?? {};
  const session = objectValue(state.session);
  const sessionLabel = session
    ? `${stringValue(session.id) || 'session'}:${numberValue(session.messages) ?? 0}`
    : 'no-session';
  const live = liveStatus(stringValue(runState.status) || 'idle');
  return (
    <Box
      flexDirection="row"
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderColor={tuiColors.border}
    >
      <Text color={tuiColors.accent} bold>
        {tuiChars.brand} SNAPDRAGON
      </Text>
      <Text color={tuiColors.muted}> {tuiChars.dash} </Text>
      <Text color={tuiColors.foreground}>
        {stringValue(state.provider)}/{stringValue(state.model)}
      </Text>
      <Text color={tuiColors.muted}> {tuiChars.dash} </Text>
      <Text color={live.color}>{live.label}</Text>
      <Box flexGrow={1} />
      <Text color={tuiColors.muted}>profile:{stringValue(state.profile) || 'none'} </Text>
      <Text color={tuiColors.muted}>{sessionLabel}</Text>
    </Box>
  );
}

export function RunStatus({ component }: { component: UiComponentSnapshot }) {
  const state = component.state;
  const status = stringValue(state.status) || 'idle';
  const usage = objectValue(state.usage);
  const error = stringValue(state.error);
  if (!usage && !error) return null;
  return (
    <Box flexDirection="row" paddingX={1}>
      <Text color={liveStatus(status).color}>{status}</Text>
      {usage ? (
        <Text color={tuiColors.muted}>
          {' '}
          in:{numberValue(usage.inputTokens) ?? 0} out:{numberValue(usage.outputTokens) ?? 0}
        </Text>
      ) : null}
      {error ? <Text color={tuiColors.error}> {error}</Text> : null}
    </Box>
  );
}

function liveStatus(status: string): { label: string; color: string } {
  if (status === 'running') return { label: 'streaming', color: tuiColors.warn };
  if (status === 'error') return { label: 'error', color: tuiColors.error };
  return { label: 'ready', color: tuiColors.ok };
}
