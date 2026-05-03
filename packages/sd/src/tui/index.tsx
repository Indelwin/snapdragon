import type { UiWorldSnapshot } from '@snapdragon-ai/ui';
import { Box, render, useApp, useWindowSize } from 'ink';
import { useEffect, useMemo, useState } from 'react';
import { defaultIo, type SdIo } from '../repl.js';
import type { SdRuntime } from '../runtime.js';
import { createDefaultInkRendererRegistry } from './components.js';
import { useSdTuiInput } from './input-controller.js';
import { fixedChromeRows } from './layout.js';
import { SdMouseProvider, SdMouseScrollListener } from './mouse-scroll.js';
import type { InkRendererRegistry } from './renderer-registry.js';
import { hasRenderableSlot, Slot } from './tui-slot.js';
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
    controller.loadSplashArt();
    return () => controller.dispose();
  }, [controller]);
  useSdTuiInput({ runtime, controller, exit });
  const mouseSettings = resolveMouseSettings(runtime);

  return (
    <SdMouseProvider enabled={mouseSettings.enabled}>
      <SdMouseScrollListener
        key="mouse-scroll"
        controller={controller}
        rowsPerTick={mouseSettings.rowsPerTick}
        enabled={mouseSettings.enabled}
      />
      <SdTuiLayout
        key="tui-layout"
        snapshot={snapshot}
        registry={rendererRegistry}
        terminalRows={terminalRows}
        mainRows={mainRows}
        mainColumns={mainColumns}
        showPanel={showPanel}
      />
    </SdMouseProvider>
  );
}

function SdTuiLayout({
  snapshot,
  registry,
  terminalRows,
  mainRows,
  mainColumns,
  showPanel,
}: {
  snapshot: UiWorldSnapshot;
  registry: InkRendererRegistry;
  terminalRows: number;
  mainRows: number;
  mainColumns: number;
  showPanel: boolean;
}) {
  return (
    <Box flexDirection="column" height={terminalRows} overflow="hidden">
      <Slot slot="status" snapshot={snapshot} registry={registry} />
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
            registry={registry}
            viewportRows={mainRows}
            viewportColumns={mainColumns}
          />
        </Box>
        {showPanel ? (
          <Box width={44} flexDirection="column" flexShrink={0} overflow="hidden">
            <Slot
              slot="panel"
              snapshot={snapshot}
              registry={registry}
              viewportRows={mainRows}
              viewportColumns={44}
            />
          </Box>
        ) : null}
      </Box>
      <Slot slot="overlay" snapshot={snapshot} registry={registry} />
      <Slot slot="input" snapshot={snapshot} registry={registry} />
      <Slot slot="footer" snapshot={snapshot} registry={registry} />
    </Box>
  );
}

function resolveMouseSettings(runtime: SdRuntime): { enabled: boolean; rowsPerTick: number } {
  const cfg = runtime.config.tui?.mouse;
  const enabled = cfg?.enabled !== false;
  const rowsPerTick = Math.max(1, cfg?.scroll_rows ?? 3);
  return { enabled, rowsPerTick };
}

export { createDefaultInkRendererRegistry } from './components.js';
export { type InkRenderer, InkRendererRegistry } from './renderer-registry.js';
export { initialSdUiEvents, SD_UI_IDS, type SdUiComponentKind, SdUiController } from './ui.js';
