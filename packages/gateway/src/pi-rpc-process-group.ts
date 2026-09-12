import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const ownedGroups = new WeakSet<ChildProcessWithoutNullStreams>();

// Only children spawned detached by this adapter may be addressed as groups.
export function ownPiProcessGroup(child: ChildProcessWithoutNullStreams): void {
  ownedGroups.add(child);
}

export function piProcessAlive(child: ChildProcessWithoutNullStreams): boolean {
  if (!ownedGroups.has(child)) return child.exitCode === null && child.signalCode === null;
  const pid = child.pid;
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ESRCH' || code === 'EPERM') return false;
    throw cause;
  }
}

export function signalPiProcess(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (ownedGroups.has(child)) process.kill(-pid, signal);
    else if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') throw cause;
  }
}
