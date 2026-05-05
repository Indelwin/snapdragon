import { spawn } from 'node:child_process';
import { closeSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { RustGatewayClient } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import type { SdConfig } from './config.js';
import { daemonPathsForConfig } from './daemon-paths.js';
import { daemonPid, isPidAlive } from './daemon-status.js';
import { rustGatewayCommand } from './gateway-rust-command.js';
import { configuredRustGatewayServices } from './gateway-rust-config.js';
import { formatRustGatewayStatus } from './gateway-rust-status.js';

const STARTUP_TIMEOUT_MS = 8_000;

export async function startRustGateway(args: SdCliArgs, config: SdConfig): Promise<string> {
  const paths = daemonPathsForConfig(config);
  const pid = daemonPid(paths);
  if (pid && isPidAlive(pid)) return `rust gateway already running (${pid})`;

  rmSync(paths.gatewaySocket, { force: true });
  const child = spawnRustGatewayProcess(args, paths.gatewaySocket, paths.log);
  writeFileSync(paths.pid, `${child.pid}\n`, 'utf8');
  await waitForRustGateway(paths.gatewaySocket);
  await registerConfiguredServices(paths.gatewaySocket, config, args.configPath);
  return `started rust gateway (${child.pid})`;
}

export async function stopRustGateway(config: SdConfig): Promise<string> {
  const paths = daemonPathsForConfig(config);
  const pid = daemonPid(paths);
  if (!pid || !isPidAlive(pid)) {
    cleanupRustGateway(paths.gatewaySocket);
    return 'rust gateway is not running';
  }
  process.kill(pid, 'SIGTERM');
  cleanupRustGateway(paths.gatewaySocket);
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

function spawnRustGatewayProcess(_args: SdCliArgs, socketPath: string, logPath: string) {
  const command = rustGatewayCommand();
  const log = openSync(logPath, 'a');
  const child = spawn(command.bin, [...command.args, '--socket', socketPath], {
    cwd: command.cwd,
    detached: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  if (!child.pid) throw new Error('failed to spawn rust gateway daemon');
  child.unref();
  return child;
}

async function waitForRustGateway(socketPath: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < STARTUP_TIMEOUT_MS) {
    try {
      await new RustGatewayClient({ socketPath, timeoutMs: 500 }).status();
      return;
    } catch {
      await sleep(50);
    }
  }
  throw new Error(`rust gateway did not open ${socketPath}`);
}

async function registerConfiguredServices(
  socketPath: string,
  config: SdConfig,
  configPath?: string,
): Promise<void> {
  const client = new RustGatewayClient({ socketPath });
  for (const service of configuredRustGatewayServices(config, configPath)) {
    await client.registerService(service);
  }
}

function cleanupRustGateway(socketPath: string): void {
  rmSync(socketPath, { force: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
