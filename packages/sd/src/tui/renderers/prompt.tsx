import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { locateCursor } from '../draft-edit.js';
import {
  arrayOfStrings,
  optionalStringValue,
  promptCompletion,
  stringValue,
} from '../state-readers.js';
import { tuiChars, tuiColors } from '../theme.js';
import { Shimmer, Spinner } from './effects.js';

export function PromptInput({ component }: { component: UiComponentSnapshot }) {
  const draft = stringValue(component.state.draft);
  const rawCursor = component.state.cursor;
  const cursor = typeof rawCursor === 'number' ? rawCursor : draft.length;
  const running = component.state.running === true;
  const phase = optionalStringValue(component.state.phase);
  const phaseLabel = optionalStringValue(component.state.phaseLabel);
  const attachments = arrayOfStrings(component.state.attachments);
  const completion = promptCompletion(component.state);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderLeft={false}
      borderRight={false}
      borderBottom={false}
      borderColor={tuiColors.borderStrong}
      paddingX={1}
    >
      {attachments.length > 0 ? (
        <Text color={tuiColors.tool}>
          {attachments.length} attachment(s): {attachments.join(', ')}
        </Text>
      ) : null}
      {running ? (
        <RunningIndicator phase={phase} phaseLabel={phaseLabel} />
      ) : (
        renderDraftLines(draft, cursor)
      )}
      {completion && completion.suggestions.length > 0 ? (
        <CompletionList completion={completion} />
      ) : null}
    </Box>
  );
}

function RunningIndicator({
  phase,
  phaseLabel,
}: {
  phase: string | undefined;
  phaseLabel: string | undefined;
}) {
  const label = runningLabel(phase, phaseLabel);
  return (
    <Text>
      <Spinner /> <Shimmer text={label} />
    </Text>
  );
}

function runningLabel(phase: string | undefined, phaseLabel: string | undefined): string {
  if (phase === 'tool') return phaseLabel ? `Running ${phaseLabel}...` : 'Running tool...';
  if (phase === 'thinking') return 'Thinking...';
  if (phase === 'streaming') return 'Streaming...';
  // Free-form phase used by long-running slash commands (e.g. /reload).
  // The label has already been authored by the caller, so render it
  // verbatim — no "Connecting" / "Running" prefix.
  if (phase === 'task') return phaseLabel ?? 'Working...';
  return 'Connecting...';
}

function CompletionList({
  completion,
}: {
  completion: NonNullable<ReturnType<typeof promptCompletion>>;
}) {
  const title = completionTitle(completion.mode);
  const selectable = selectableMode(completion.mode);
  const visible = visibleSuggestions(completion, selectable ? 12 : 10);
  const hint = selectable ? 'enter select' : 'tab complete';
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={tuiColors.borderStrong}
      paddingX={1}
    >
      <Text color={tuiColors.accentSoft} bold>
        {title}
        <Text color={tuiColors.muted}>
          {' '}
          {tuiChars.dash} {hint}
        </Text>
      </Text>
      {visible.map(({ suggestion, index }) => (
        <Text
          key={`${suggestion.kind}-${suggestion.label}`}
          color={index === completion.selectedIndex ? tuiColors.accentSoft : tuiColors.foreground}
          bold={index === completion.selectedIndex}
        >
          {index === completion.selectedIndex ? `${tuiChars.pointer} ` : '  '}
          {suggestion.label}
          <Text color={tuiColors.muted}>
            {' '}
            {tuiChars.dash} {suggestion.description}
          </Text>
        </Text>
      ))}
    </Box>
  );
}

function completionTitle(mode: string): string {
  if (mode === 'shell') return 'shell';
  if (mode === 'provider') return 'providers';
  if (mode === 'model') return 'models';
  if (mode === 'session') return 'sessions';
  if (mode === 'profile') return 'profiles';
  return 'commands';
}

function selectableMode(mode: string): boolean {
  return mode === 'provider' || mode === 'model' || mode === 'session' || mode === 'profile';
}

function visibleSuggestions(
  completion: NonNullable<ReturnType<typeof promptCompletion>>,
  limit: number,
): Array<{
  suggestion: NonNullable<ReturnType<typeof promptCompletion>>['suggestions'][number];
  index: number;
}> {
  const maxStart = Math.max(0, completion.suggestions.length - limit);
  const start = Math.min(Math.max(0, completion.selectedIndex - limit + 1), maxStart);
  return completion.suggestions.slice(start, start + limit).map((suggestion, offset) => ({
    suggestion,
    index: start + offset,
  }));
}

function splitLines(text: string): string[] {
  return text.length > 0 ? text.split('\n') : [''];
}

/**
 * Render the draft as one `<Text>` per logical line, splitting the cursor's
 * line into prefix + cursor block + suffix. The cursor block visually
 * occupies one column, drawn over the character it sits on (or after the
 * line's last char when the cursor is at end-of-line).
 */
function renderDraftLines(draft: string, cursor: number) {
  const lines = splitLines(draft);
  const cursorPos = locateCursor(draft, cursor);
  return lines.map((lineText, index) => {
    const isFirst = index === 0;
    const gutter = (
      <>
        <Text color={tuiColors.accent}>{isFirst ? tuiChars.prompt : ' '}</Text>{' '}
      </>
    );
    // Prompt lines don't reorder — they're regenerated each render from
    // splitLines(draft). Index-in-key is therefore stable; suppressing the
    // generic noArrayIndexKey rule for this positional structure.
    if (index !== cursorPos.line) {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable positional key for prompt lines
        <Text key={`prompt-${index}-${lineText}`}>
          {gutter}
          <Text color={tuiColors.foreground}>{lineText}</Text>
        </Text>
      );
    }
    const col = Math.min(cursorPos.column, lineText.length);
    const before = lineText.slice(0, col);
    const at = lineText.slice(col, col + 1);
    const after = lineText.slice(col + 1);
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: stable positional key for prompt lines
      <Text key={`prompt-${index}-${lineText}-c${col}`}>
        {gutter}
        <Text color={tuiColors.foreground}>{before}</Text>
        <Text color={tuiColors.accentSoft}>{at || tuiChars.cursor}</Text>
        {at ? <Text color={tuiColors.foreground}>{after}</Text> : null}
      </Text>
    );
  });
}
