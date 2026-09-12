import { basename } from 'node:path';
import { argv, stdout } from 'node:process';
import { startSdDiagnostics } from './diagnostics.js';
import {
  bindSdDiagnosticsAgentPhases,
  type SdDiagnosticsAgentPhaseBinding,
} from './diagnostics-agent-phase.js';
import type { SdDiagnosticsHandle, SdDiagnosticsOptions } from './diagnostics-types.js';
import { registerSdWebtoolsWasmPages } from './diagnostics-webtools.js';
import { writeExitSummary } from './exit-summary.js';
import { runInteractive, runOneShot } from './repl.js';
import type { SdRuntime } from './runtime.js';
import { runtimeWarningLines } from './runtime-warnings.js';

export type SdSelectedRunMode = 'tui' | 'repl' | 'print';

export interface SdSelectedRunModeOptions {
  diagnostics?: Omit<SdDiagnosticsOptions, 'enabled'> & { enabled?: boolean };
}

export async function runSelectedMode(
  mode: SdSelectedRunMode,
  runtime: SdRuntime,
  prompt: string | undefined,
  options: SdSelectedRunModeOptions = {},
): Promise<void> {
  const diagnosticsEnabled =
    (options.diagnostics?.enabled ?? runtime.options.diagnostics === true) &&
    !options.diagnostics?.signal?.aborted;
  const unregisterWebtoolsWasm = await registerSdWebtoolsWasmPages(diagnosticsEnabled);
  try {
    const diagnostics = startRunDiagnostics(runtime, options);
    let phaseBinding: SdDiagnosticsAgentPhaseBinding | undefined;
    try {
      await diagnostics.flush();
      if (diagnostics.enabled) phaseBinding = bindSdDiagnosticsAgentPhases(runtime, diagnostics);
      await executeSelectedMode(mode, runtime, prompt);
    } finally {
      phaseBinding?.dispose();
      await stopRunDiagnostics(diagnostics);
    }
  } finally {
    unregisterWebtoolsWasm();
  }
}

async function executeSelectedMode(
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

function startRunDiagnostics(
  runtime: SdRuntime,
  options: SdSelectedRunModeOptions,
): SdDiagnosticsHandle {
  const diagnosticsOptions = options.diagnostics;
  return startSdDiagnostics({
    ...diagnosticsOptions,
    enabled: diagnosticsOptions?.enabled ?? runtime.options.diagnostics === true,
    initialPhase: diagnosticsOptions?.initialPhase ?? 'startup',
  });
}

async function stopRunDiagnostics(diagnostics: SdDiagnosticsHandle): Promise<void> {
  diagnostics.setPhase('shutdown');
  await diagnostics.sample();
  await diagnostics.stop();
}

function invokedCommand(): string {
  const entrypoint = argv[1];
  if (!entrypoint) return 'sd';
  return basename(entrypoint) === 'sd' ? entrypoint : 'sd';
}

function writeRuntimeWarnings(runtime: SdRuntime): void {
  for (const warning of runtimeWarningLines(runtime)) stdout.write(`${warning}\n`);
}
