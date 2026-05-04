import { rmSync, writeFileSync } from 'node:fs';
import type { SdDaemonPaths } from './daemon-paths.js';
import { daemonPid, isPidAlive, writeDaemonStatus } from './daemon-status.js';
import type { SdRuntime } from './runtime.js';
import type { SdRuntimeOptions } from './runtime-options.js';

const STATUS_INTERVAL_MS = 2_000;

export function claimDaemon(paths: SdDaemonPaths): void {
  const pid = daemonPid(paths);
  if (pid && pid !== process.pid && isPidAlive(pid)) {
    throw new Error(`sd daemon already running (${pid})`);
  }
  writeFileSync(paths.pid, `${process.pid}\n`, 'utf8');
}

export function releaseDaemon(paths: SdDaemonPaths): void {
  const pid = daemonPid(paths);
  if (pid === undefined || pid === process.pid || !isPidAlive(pid)) {
    rmSync(paths.pid, { force: true });
  }
}

export async function runUntilSignal(
  runtime: SdRuntime,
  paths: SdDaemonPaths,
  options: SdRuntimeOptions,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const writeStatus = () => writeRuntimeStatus(runtime, paths, options, startedAt);
  writeStatus();
  const timer = setInterval(writeStatus, STATUS_INTERVAL_MS);
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  clearInterval(timer);
  writeStatus();
}

function writeRuntimeStatus(
  runtime: SdRuntime,
  paths: SdDaemonPaths,
  options: SdRuntimeOptions,
  startedAt: string,
): void {
  writeDaemonStatus(paths, {
    pid: process.pid,
    started_at: startedAt,
    updated_at: new Date().toISOString(),
    config_path: options.configPath,
    cwd: options.cwd,
    services: runtime.background.list(),
  });
}
