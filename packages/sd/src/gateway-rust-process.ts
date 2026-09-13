import { writeFileSync } from 'node:fs';
import { RustGatewayClient } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import type { SdConfig } from './config.js';
import { daemonPathsForConfig } from './daemon-paths.js';
import { daemonPid, isPidAlive } from './daemon-status.js';
import { configuredRustGatewayServices } from './gateway-rust-config.js';
import {
  registerConfiguredServices,
  spawnRustGatewayProcess,
  waitForRustGateway,
  waitForRustGatewayExit,
} from './gateway-rust-lifecycle.js';
import { formatRustGatewayStatus } from './gateway-rust-status.js';

export async function startRustGateway(args: SdCliArgs, config: SdConfig): Promise<string> {
  const paths = daemonPathsForConfig(config);
  const pid = daemonPid(paths);
  if (pid && isPidAlive(pid)) return `rust gateway already running (${pid})`;

  const child = spawnRustGatewayProcess(args, paths.gatewaySocket, paths.gatewayDb, paths.log);
  writeFileSync(paths.pid, `${child.pid}\n`, 'utf8');
  await waitForRustGateway(paths.gatewaySocket);
  await registerConfiguredServices(paths.gatewaySocket, config, args.configPath);
  return `started rust gateway (${child.pid})`;
}

export async function stopRustGateway(config: SdConfig): Promise<string> {
  const paths = daemonPathsForConfig(config);
  const pid = daemonPid(paths);
  if (!pid || !isPidAlive(pid)) {
    return 'rust gateway is not running';
  }
  process.kill(pid, 'SIGTERM');
  await waitForRustGatewayExit(pid);
  return `stopping rust gateway (${pid})`;
}

export async function rustGatewayStatus(config: SdConfig): Promise<string> {
  const paths = daemonPathsForConfig(config);
  const pid = daemonPid(paths);
  const running = pid !== undefined && isPidAlive(pid);
  if (!running) return formatRustGatewayStatus(paths, pid, false);
  try {
    const status = await new RustGatewayClient({ socketPath: paths.gatewaySocket }).status();
    return formatRustGatewayStatus(paths, pid, true, status);
  } catch (error) {
    return formatRustGatewayStatus(paths, pid, true, undefined, errorMessage(error));
  }
}

export async function runRustGatewayOnce(config: SdConfig, configPath?: string): Promise<string> {
  const paths = daemonPathsForConfig(config);
  const client = new RustGatewayClient({ socketPath: paths.gatewaySocket });
  const statuses = [];
  for (const service of configuredRustGatewayServices(config, configPath)) {
    statuses.push(await client.runService(service.name));
  }
  return statuses
    .filter((status) => status !== undefined)
    .map((status) => `${status.name}: runs=${status.runs} errors=${status.errors}`)
    .join('\n')
    .concat('\n');
}

export async function restartRustGateway(args: SdCliArgs, config: SdConfig): Promise<string> {
  const stopped = await stopRustGateway(config);
  const started = await startRustGateway(args, config);
  return `${stopped}\n${started}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
