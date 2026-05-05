import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import {
  restartRustGateway,
  runRustGatewayOnce,
  rustGatewayStatus,
  startRustGateway,
  stopRustGateway,
} from './gateway-rust-process.js';

export type GatewayDaemonAlias = 'start' | 'stop' | 'status' | 'run-once';

export function isGatewayDaemonAlias(value: string): value is GatewayDaemonAlias {
  return value === 'start' || value === 'stop' || value === 'status' || value === 'run-once';
}

export async function runGatewayDaemonAlias(
  action: GatewayDaemonAlias,
  args: SdCliArgs,
): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  if (config.gateway?.runtime !== 'inline-ts') return runRustGatewayAlias(action, args, config);
  const { runSdDaemonOnce, sdDaemonStatus, startSdDaemon, stopSdDaemon } = await import(
    './daemon.js'
  );
  const handlers = {
    start: startSdDaemon,
    stop: stopSdDaemon,
    status: sdDaemonStatus,
    'run-once': runSdDaemonOnce,
  };
  return `${gatewayRuntimeHeader(config)}${await handlers[action](args)}`;
}

export async function restartGateway(args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  if (config.gateway?.runtime !== 'inline-ts') {
    return `${gatewayRuntimeHeader(config)}${await restartRustGateway(args, config)}`;
  }
  const { startSdDaemon, stopSdDaemon } = await import('./daemon.js');
  const stopped = await stopSdDaemon(args);
  const started = await startSdDaemon(args);
  return `${gatewayRuntimeHeader(config)}${stopped}\n${started}`;
}

async function runRustGatewayAlias(
  action: GatewayDaemonAlias,
  args: SdCliArgs,
  config: Awaited<ReturnType<typeof loadSdConfig>>,
): Promise<string> {
  const handlers = {
    start: () => startRustGateway(args, config),
    stop: () => stopRustGateway(config),
    status: () => rustGatewayStatus(config),
    'run-once': () => runRustGatewayOnce(config, args.configPath),
  };
  return `${gatewayRuntimeHeader(config)}${await handlers[action]()}`;
}

function gatewayRuntimeHeader(config: Awaited<ReturnType<typeof loadSdConfig>>): string {
  const runtime = config.gateway?.runtime ?? 'rust';
  return `gateway runtime=${runtime}\n`;
}
