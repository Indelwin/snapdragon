import { basename } from 'node:path';
import { argv, stdout } from 'node:process';
import { writeExitSummary } from './exit-summary.js';
import { runInteractive, runOneShot } from './repl.js';
import type { SdRuntime } from './runtime.js';
import { runtimeWarningLines } from './runtime-warnings.js';

export type SdSelectedRunMode = 'tui' | 'repl' | 'print';

export async function runSelectedMode(
  mode: SdSelectedRunMode,
  runtime: SdRuntime,
  prompt: string | undefined,
): Promise<void> {
  if (mode === 'print') {
    if (!prompt) throw new Error('Print mode requires a prompt.');
    writeRuntimeWarnings(runtime);
    await runOneShot(runtime, prompt);
    return;
  }
  if (mode === 'repl') {
    await runInteractive(runtime);
  } else {
    const { runTui } = await import('./tui/index.js');
    await runTui(runtime);
  }
  await writeExitSummary(runtime, stdout, { command: invokedCommand() });
}

function invokedCommand(): string {
  const entrypoint = argv[1];
  if (!entrypoint) return 'sd';
  return basename(entrypoint) === 'sd' ? entrypoint : 'sd';
}

function writeRuntimeWarnings(runtime: SdRuntime): void {
  for (const warning of runtimeWarningLines(runtime)) stdout.write(`${warning}\n`);
}
