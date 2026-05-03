import type { UiComponentSnapshot } from '@snapdragon-ai/ui';
import { Box, Text } from 'ink';
import type React from 'react';
import { eventEntries, toolEntries } from '../state-readers.js';
import { tuiColors } from '../theme.js';
import { EventEntryLine, EventLogBox, EventLogHeader } from './event-line.js';
import { eventEntryCap, toolEntryCap } from './panel-caps.js';

export function ToolPanel({
  component,
  viewportRows,
}: {
  component: UiComponentSnapshot;
  viewportRows?: number;
}) {
  const tools = toolEntries(component.state);
  if (component.state.open === false || tools.length === 0) return null;
  const visible = tools.slice(-toolEntryCap(viewportRows));
  return <PanelBox title="tools">{visible.map(toolLine)}</PanelBox>;
}

function toolLine(tool: ReturnType<typeof toolEntries>[number]) {
  const color = tool.status === 'error' ? tuiColors.error : tuiColors.tool;
  return (
    <Text key={tool.id} color={color}>
      {tool.status} {tool.name}
    </Text>
  );
}

function PanelBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box
      flexDirection="column"
      flexShrink={1}
      borderStyle="round"
      borderColor={tuiColors.borderStrong}
      paddingX={1}
      marginRight={1}
      overflow="hidden"
    >
      <Text color={tuiColors.accentSoft} bold>
        {title}
      </Text>
      {children}
    </Box>
  );
}

export function EventLog({
  component,
  viewportRows,
}: {
  component: UiComponentSnapshot;
  viewportRows?: number;
}) {
  if (component.state.open === false) return null;
  const entries = eventEntries(component.state);
  const visible = entries.slice(-eventEntryCap(viewportRows));
  return (
    <EventLogBox>
      <EventLogHeader total={entries.length} />
      {visible.length === 0 ? <Text color={tuiColors.muted}>(nothing yet)</Text> : null}
      {visible.map((entry) => (
        <EventEntryLine key={entry.id} entry={entry} />
      ))}
    </EventLogBox>
  );
}
