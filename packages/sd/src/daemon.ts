import { stdout } from 'node:process';
import { loadSdConfig, loadSdEnvironment } from './config.js';
import { claimDaemon, releaseDaemon, runUntilSignal } from './daemon-lifecycle.js';
import { daemonPathsForConfig } from './daemon-paths.js';
import { formatDaemonStatus, formatServiceRuns } from './daemon-report.js';
import { ensureSdDaemonProcess } from './daemon-spawn.js';
import { daemonPid, isPidAlive, readDaemonStatus } from './daemon-status.js';
import type { SdRuntime } from './runtime.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export async function runSdDaemon(options: SdRuntimeOptions): Promise<void> {
  await loadSdEnvironment(undefined, process.env);
  const config = await loadSdConfig(options.configPath);
  const paths = daemonPathsForConfig(config);
  claimDaemon(paths);
  let runtime: SdRuntime | undefined;
  try {
    const { createSdRuntime } = await import('./runtime.js');
    runtime = await createSdRuntime({
      ...options,
      noSession: true,
      noBackground: false,
      backgroundMode: 'inline',
    });
    await runUntilSignal(runtime, paths, options);
  } finally {
    if (runtime) await stopRuntime(runtime);
    releaseDaemon(paths);
  }
}

export async function startSdDaemon(options: SdRuntimeOptions): Promise<string> {
  const config = await loadSdConfig(options.configPath);
  const paths = daemonPathsForConfig(config);
  const pid = daemonPid(paths);
  if (pid && isPidAlive(pid)) return `sd daemon already running (${pid})`;
  return ensureSdDaemonProcess(options, config);
}

export async function stopSdDaemon(options: SdRuntimeOptions): Promise<string> {
  const config = await loadSdConfig(options.configPath);
  const paths = daemonPathsForConfig(config);
  const pid = daemonPid(paths);
  if (!pid || !isPidAlive(pid)) {
    releaseDaemon(paths);
    return 'sd daemon is not running';
  }
  process.kill(pid, 'SIGTERM');
  return `stopping sd daemon (${pid})`;
}

export async function sdDaemonStatus(options: SdRuntimeOptions): Promise<string> {
  const config = await loadSdConfig(options.configPath);
  const paths = daemonPathsForConfig(config);
  const pid = daemonPid(paths);
  const status = readDaemonStatus(paths);
  const running = pid !== undefined && isPidAlive(pid);
  return formatDaemonStatus(paths, pid, running, status);
}

export async function runSdDaemonOnce(options: SdRuntimeOptions): Promise<string> {
  const { createSdRuntime } = await import('./runtime.js');
  const runtime = await createSdRuntime({
    ...options,
    noSession: true,
    noBackground: false,
    backgroundMode: 'inline',
  });
  try {
    for (const service of runtime.background.list()) await runtime.background.runNow(service.name);
    return formatServiceRuns(runtime);
  } finally {
    await stopRuntime(runtime);
  }
}

export async function writeDaemonResult(message: Promise<string>): Promise<void> {
  stdout.write(await message);
}

async function stopRuntime(runtime: SdRuntime): Promise<void> {
  const { stopSdRuntime } = await import('./runtime.js');
  stopSdRuntime(runtime);
}
