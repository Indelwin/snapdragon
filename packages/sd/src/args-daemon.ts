import type { SdCliArgs } from './args-types.js';

const daemonActions = new Set(['run', 'start', 'stop', 'status', 'run-once']);

export function applyDaemonToken(raw: string, out: SdCliArgs, promptParts: string[]): boolean {
  if (raw.startsWith('-')) return false;
  if (isDaemonCommand(raw, out, promptParts)) {
    out.mode = 'daemon';
    out.daemonAction = 'run';
    return true;
  }
  if (!isDaemonActionSlot(out)) return false;
  const action = parseDaemonAction(raw);
  if (!action) return false;
  out.daemonAction = action;
  return true;
}

function isDaemonCommand(raw: string, out: SdCliArgs, promptParts: string[]): boolean {
  return raw === 'daemon' && out.mode === 'tui' && promptParts.length === 0;
}

function isDaemonActionSlot(out: SdCliArgs): boolean {
  return out.mode === 'daemon' && out.daemonAction === 'run';
}

function parseDaemonAction(raw: string): SdCliArgs['daemonAction'] | undefined {
  if (daemonActions.has(raw)) return raw as SdCliArgs['daemonAction'];
  return undefined;
}
