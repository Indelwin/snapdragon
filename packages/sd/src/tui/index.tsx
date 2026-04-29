import type { UiComponentSnapshot, UiWorldSnapshot } from '@snapdragon-ai/ui';
import { Box, render, useApp, useWindowSize } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { defaultIo, type SdIo } from '../repl.js';
import type { SdRuntime } from '../runtime.js';
import { createDefaultInkRendererRegistry } from './components.js';
import { useSdTuiInput } from './input-controller.js';
import { fillsSlot, fixedChromeRows } from './layout.js';
import type { InkRendererRegistry } from './renderer-registry.js';
import { SdUiController } from './ui.js';

export interface SdTuiOptions {
  io?: SdIo;
  registry?: InkRendererRegistry;
  controller?: SdUiController;
  clearScreen?: boolean;
}

export async function runTui(runtime: SdRuntime, options: SdTuiOptions = {}): Promise<void> {
  const controller = options.controller ?? new SdUiController(runtime);
  const registry = options.registry ?? createDefaultInkRendererRegistry();
  const io = options.io ?? defaultIo;
  if (options.clearScreen !== false) io.output.write('\x1b[2J\x1b[3J\x1b[H');
  const instance = render(
    <SdTuiApp runtime={runtime} controller={controller} registry={registry} />,
    {
      stdin: io.input as NodeJS.ReadStream,
      stdout: io.output as NodeJS.WriteStream,
      stderr: io.error as NodeJS.WriteStream,
    },
  );
  await instance.waitUntilExit();
}

export function SdTuiApp({
  runtime,
  controller,
  registry,
}: {
  runtime: SdRuntime;
  controller: SdUiController;
  registry?: InkRendererRegistry;
}) {
  const { exit } = useApp();
  const rendererRegistry = useMemo(
    () => registry ?? createDefaultInkRendererRegistry(),
    [registry],
  );
  const [snapshot, setSnapshot] = useState<UiWorldSnapshot>(() => controller.world.snapshot());
  const { rows, columns } = useWindowSize();
  const terminalRows = Math.max(16, rows);
  const terminalColumns = Math.max(40, columns);
  const showPanel = hasRenderableSlot('panel', snapshot);
  const mainRows = Math.max(1, terminalRows - fixedChromeRows(snapshot));
  const mainColumns = Math.max(20, terminalColumns - (showPanel ? 45 : 0));

  useEffect(() => controller.world.subscribe(setSnapshot), [controller]);
  useEffect(() => {
    controller.bindRuntimeAgent();
    void controller.loadSplashArt();
    return () => controller.dispose();
  }, [controller]);
  useSdTuiInput({ runtime, controller, exit });

  return (
    <Box flexDirection="column" height={terminalRows} overflow="hidden">
      <Slot slot="status" snapshot={snapshot} registry={rendererRegistry} />
      <Box flexDirection="row" flexGrow={1} flexShrink={1} minHeight={1} overflow="hidden">
        <Box
          flexGrow={1}
          flexShrink={1}
          flexDirection="column"
          marginRight={showPanel ? 1 : 0}
          overflow="hidden"
        >
          <Slot
            slot="main"
            snapshot={snapshot}
            registry={rendererRegistry}
            viewportRows={mainRows}
            viewportColumns={mainColumns}
          />
        </Box>
        {showPanel ? (
          <Box width={44} flexDirection="column" flexShrink={0} overflow="hidden">
            <Slot
              slot="panel"
              snapshot={snapshot}
              registry={rendererRegistry}
              viewportRows={mainRows}
              viewportColumns={44}
            />
          </Box>
        ) : null}
      </Box>
      <Slot slot="overlay" snapshot={snapshot} registry={rendererRegistry} />
      <Slot slot="input" snapshot={snapshot} registry={rendererRegistry} />
      <Slot slot="footer" snapshot={snapshot} registry={rendererRegistry} />
    </Box>
  );
}

function Slot({
  slot,
  snapshot,
  registry,
  viewportRows,
  viewportColumns,
}: {
  slot: string;
  snapshot: UiWorldSnapshot;
  registry: InkRendererRegistry;
  viewportRows?: number;
  viewportColumns?: number;
}) {
  const components = Object.values(snapshot.components)
    .filter(
      (component) => component.descriptor.slot === slot && component.descriptor.visible !== false,
    )
    .sort(compareComponents);
  return (
    <>
      {components.map((component) => (
        <Box
          key={component.descriptor.id}
          flexDirection="column"
          flexGrow={fillsSlot(slot, component) ? 1 : 0}
          flexShrink={fillsSlot(slot, component) ? 1 : 0}
          overflow="hidden"
        >
          {registry.render(component, { snapshot, viewportRows, viewportColumns })}
        </Box>
      ))}
    </>
  );
}

function compareComponents(a: UiComponentSnapshot, b: UiComponentSnapshot): number {
  const byOrder = (a.descriptor.order ?? 0) - (b.descriptor.order ?? 0);
  if (byOrder !== 0) return byOrder;
  return a.descriptor.id.localeCompare(b.descriptor.id);
}

function hasRenderableSlot(slot: string, snapshot: UiWorldSnapshot): boolean {
  return Object.values(snapshot.components).some(
    (component) =>
      component.descriptor.slot === slot &&
      component.descriptor.visible !== false &&
      isRenderable(component),
  );
}

function isRenderable(component: UiComponentSnapshot): boolean {
  if (component.descriptor.kind === 'event.log') return component.state.open === true;
  if (component.descriptor.kind === 'tool.panel') {
    return component.state.open !== false && hasArrayItems(component.state.tools);
  }
  return true;
}

function hasArrayItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export { createDefaultInkRendererRegistry } from './components.js';
export { type InkRenderer, InkRendererRegistry } from './renderer-registry.js';
export { initialSdUiEvents, SD_UI_IDS, type SdUiComponentKind, SdUiController } from './ui.js';
