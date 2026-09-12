import { basename } from 'node:path';
import { argv, stdout } from 'node:process';
import { writeExitSummary } from './exit-summary.js';
import type { SdRestartRequest } from './reload.js';
import { runInteractive } from './repl-interactive.js';
import { runOneShot } from './repl-run-once.js';
import type { SdRuntime } from './runtime.js';
import { runtimeWarningLines } from './runtime-warnings.js';

export type SdSelectedRunMode = 'tui' | 'repl' | 'print';

export async function runSelectedMode(
  mode: SdSelectedRunMode,
  runtime: SdRuntime,
  prompt: string | undefined,
  draft?: string,
  signal?: AbortSignal,
): Promise<SdRestartRequest | undefined> {
  if (mode === 'print') {
    if (!prompt) throw new Error('Print mode requires a prompt.');
    writeRuntimeWarnings(runtime);
    await runOneShot(runtime, prompt, [], undefined, { signal });
    return undefined;
  }
  let restart: SdRestartRequest | undefined;
  if (mode === 'repl') {
    restart = await runInteractive(runtime, undefined, signal);
  } else {
    const { runTui } = await import('./tui/index.js');
    restart = await runTui(runtime, { initialDraft: draft, signal });
  }
  if (restart) return restart;
  await writeExitSummary(runtime, stdout, { command: invokedCommand() });
  return undefined;
}

function invokedCommand(): string {
  const entrypoint = argv[1];
  if (!entrypoint) return 'sd';
  return basename(entrypoint) === 'sd' ? entrypoint : 'sd';
}

function writeRuntimeWarnings(runtime: SdRuntime): void {
  for (const warning of runtimeWarningLines(runtime)) stdout.write(`${warning}\n`);
}
