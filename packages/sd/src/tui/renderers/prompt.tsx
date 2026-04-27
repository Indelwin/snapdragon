import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import { arrayOfStrings, promptCompletion, stringValue } from '../state-readers.js';
import { tuiChars, tuiColors } from '../theme.js';

export function PromptInput({ component }: { component: UiComponentSnapshot }) {
  const draft = stringValue(component.state.draft);
  const running = component.state.running === true;
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
      {lineItems(draft).map((line) => (
        <Text key={`prompt-${line.key}`}>
          <Text color={running ? tuiColors.warn : tuiColors.accent}>
            {line.first ? tuiChars.prompt : ' '}
          </Text>{' '}
          <Text color={tuiColors.foreground}>{line.text}</Text>
          {line.last && !running ? (
            <Text color={tuiColors.accentSoft}>{tuiChars.cursor}</Text>
          ) : null}
        </Text>
      ))}
      {completion && completion.suggestions.length > 0 ? (
        <CompletionList completion={completion} />
      ) : null}
    </Box>
  );
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

function lineItems(text: string): Array<{
  key: string;
  text: string;
  first: boolean;
  last: boolean;
}> {
  const lines = splitLines(text);
  return lines.map((line, index) => ({
    key: `${index}-${line}`,
    text: line,
    first: index === 0,
    last: index === lines.length - 1,
  }));
}
