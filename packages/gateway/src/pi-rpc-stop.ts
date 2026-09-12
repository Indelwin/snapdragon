import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { piProcessAlive, signalPiProcess } from './pi-rpc-process-group.js';

export { ownPiProcessGroup } from './pi-rpc-process-group.js';

export async function stopPiProcess(
  child: ChildProcessWithoutNullStreams,
  shutdownGraceMs: number,
): Promise<void> {
  if (!child.pid) return;
  if (!child.stdin.destroyed) child.stdin.end();
  if (await waitForStopped(child, shutdownGraceMs)) return;
  signalPiProcess(child, 'SIGTERM');
  if (await waitForStopped(child, shutdownGraceMs)) return;
  signalPiProcess(child, 'SIGKILL');
  // Reap the child and wait for the owned group, including descendants whose
  // leader exited first. Never report success merely because kill returned.
  if (!(await waitForStopped(child, Math.max(1_000, shutdownGraceMs)))) {
    throw new Error(`Pi RPC process/group ${child.pid} did not exit after SIGKILL`);
  }
}

async function waitForStopped(
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, graceMs);
  while (piProcessAlive(child) || (child.exitCode === null && child.signalCode === null)) {
    if (Date.now() >= deadline) return false;
    await pause(Math.min(10, deadline - Date.now()));
  }
  return true;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
