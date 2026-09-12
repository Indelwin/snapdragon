#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { stderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { SdCliArgs } from './args.js';
import { parseArgs } from './args.js';
import { runPreRuntimeCommand } from './cli-commands.js';
import { prepareCliEnvironment } from './cli-environment.js';
import { isRunMode } from './modes.js';
import { suppressKnownNodeWarnings } from './node-warnings.js';
import type { SdRestartRequest, SdRestartState } from './reload.js';

suppressKnownNodeWarnings();

export async function main(
  argv = process.argv.slice(2),
  restartState?: SdRestartState,
  signal?: AbortSignal,
): Promise<SdRestartRequest | undefined> {
  const args = parseArgs(argv);
  if (restartState) applyRestartState(args, restartState);
  if (await runPreRuntimeCommand(args)) return undefined;
  if (!isRunMode(args.mode)) throw new Error(`Unsupported runtime mode: ${args.mode}`);
  const [{ createSdRuntime, stopSdRuntime }, { runSelectedMode }] = await Promise.all([
    import('./runtime.js'),
    import('./run-mode.js'),
  ]);
  const runtime = await createSdRuntime(args);
  try {
    return await runSelectedMode(args.mode, runtime, args.prompt, {
      draft: restartState?.draft,
      signal,
    });
  } finally {
    await stopSdRuntime(runtime);
  }
}

export function applyRestartState(args: SdCliArgs, state: SdRestartState): void {
  args.provider = state.provider;
  args.model = state.model;
  args.newSession = false;
  args.noSession = state.noSession;
  args.resume = !state.noSession && Boolean(state.sessionId);
  args.sessionId = state.noSession ? undefined : state.sessionId;
  args.noProfile = state.noProfile;
  args.profileName = state.noProfile ? undefined : state.profileName;
}

export { helpText } from './help.js';

export function isDirectEntrypoint(metaUrl: string, entrypoint = process.argv[1]): boolean {
  try {
    return realpathSync(entrypoint) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  prepareCliEnvironment();
  runDirectEntrypoint()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

async function runDirectEntrypoint(): Promise<number> {
  const { SD_SUPERVISED_ENV, superviseSdCli } = await import('./cli-supervisor.js');
  if (process.env[SD_SUPERVISED_ENV] === '1') return runSupervisedEntrypoint();
  return superviseSdCli(process.argv.slice(2), { entrypoint: process.argv[1] });
}

async function runSupervisedEntrypoint(): Promise<number> {
  const { SD_RESTART_EXIT_CODE, restartStateFromEnvironment, writeRestartRequest } = await import(
    './cli-supervisor.js'
  );
  const { attachSupervisedChildShutdown, ownedShutdownExitCode } = await import(
    './cli-child-shutdown.js'
  );
  const shutdown = attachSupervisedChildShutdown();
  try {
    const request = await main(
      process.argv.slice(2),
      restartStateFromEnvironment(),
      shutdown.signal,
    );
    if (!request) return shutdown.exitCode() ?? 0;
    writeRestartRequest(request);
    return SD_RESTART_EXIT_CODE;
  } catch (error) {
    const code = ownedShutdownExitCode(error, shutdown);
    if (code !== undefined) return code;
    throw error;
  } finally {
    shutdown.dispose();
  }
}
