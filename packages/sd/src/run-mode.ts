import { stdout } from 'node:process';
import { writeExitSummary } from './exit-summary.js';
import { runInteractive, runOneShot } from './repl.js';
import type { SdRuntime } from './runtime.js';

export type SdSelectedRunMode = 'tui' | 'repl' | 'print';

export async function runSelectedMode(
  mode: SdSelectedRunMode,
  runtime: SdRuntime,
  prompt: string | undefined,
): Promise<void> {
  if (mode === 'print') {
    if (!prompt) throw new Error('Print mode requires a prompt.');
    await runOneShot(runtime, prompt);
    return;
  }
  if (mode === 'repl') {
    await runInteractive(runtime);
  } else {
    const { runTui } = await import('./tui/index.js');
    await runTui(runtime);
  }
  await writeExitSummary(runtime, stdout);
}
