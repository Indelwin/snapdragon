import type { UiComponentSnapshot, UiWorldSnapshot } from '@snapdragon-ai/ui';
import { Box } from 'ink';
import { fillsSlot } from './layout.js';
import type { InkRendererRegistry } from './renderer-registry.js';
import { visibleComponentsForSlot } from './tui-slot-filter.js';

export { hasRenderableSlot, isVisibleSlot } from './tui-slot-filter.js';

export interface SlotProps {
  slot: string;
  snapshot: UiWorldSnapshot;
  registry: InkRendererRegistry;
  viewportRows?: number;
  viewportColumns?: number;
}

export function Slot(props: SlotProps) {
  const components = visibleComponentsForSlot(props.slot, props.snapshot);
  return (
    <>
      {components.map((component) => (
        <SlotItem key={component.descriptor.id} component={component} props={props} />
      ))}
    </>
  );
}

function SlotItem({ component, props }: { component: UiComponentSnapshot; props: SlotProps }) {
  const fills = fillsSlot(props.slot, component);
  const grow = fills ? 1 : 0;
  return (
    <Box flexDirection="column" flexGrow={grow} flexShrink={grow} overflow="hidden">
      {props.registry.render(component, {
        snapshot: props.snapshot,
        viewportRows: props.viewportRows,
        viewportColumns: props.viewportColumns,
      })}
    </Box>
  );
}
