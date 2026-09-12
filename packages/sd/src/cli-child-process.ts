import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { attachChildSignalPolicy, type SupervisorSignalSource } from './cli-child-signals.js';

interface ManagedChild {
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal: NodeJS.Signals): boolean;
}

type SpawnProcess = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; stdio: 'inherit' },
) => ManagedChild;

export interface SpawnSupervisedChildOptions {
  execArgv?: readonly string[];
  execPath?: string;
  signalSource?: SupervisorSignalSource;
  signalGraceMs?: number;
  signalKillMs?: number;
  spawnProcess?: SpawnProcess;
}

export function spawnSupervisedChild(
  entrypoint: string,
  options: SpawnSupervisedChildOptions = {},
) {
  return (argv: string[], env: NodeJS.ProcessEnv): Promise<number> =>
    new Promise<number>((resolve, reject) => {
      const child = (options.spawnProcess ?? spawn)(
        options.execPath ?? process.execPath,
        [...(options.execArgv ?? process.execArgv), entrypoint, ...argv],
        { env, stdio: 'inherit' },
      );
      const source = options.signalSource ?? process;
      let settled = false;
      let cleanupSignals: () => void = () => undefined;
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanupSignals();
        reject(error);
      };
      cleanupSignals = attachChildSignalPolicy(child, source, {
        groupDeliveryGraceMs: options.signalGraceMs ?? 250,
        forceKillMs: options.signalKillMs ?? 5_000,
        onForceKillFailure: rejectOnce,
      });
      child.once('error', rejectOnce);
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        cleanupSignals();
        resolve(code ?? signalExitCode(signal) ?? 1);
      });
    });
}

function signalExitCode(signal: NodeJS.Signals | null): number | undefined {
  if (!signal) return undefined;
  const signalNumber = constants.signals[signal];
  return signalNumber === undefined ? undefined : 128 + signalNumber;
}
