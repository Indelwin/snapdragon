import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { RustGatewayClient } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import type { SdConfig } from './config.js';
import { isPidAlive } from './daemon-status.js';
import { rustGatewayCommand } from './gateway-rust-command.js';
import { configuredRustGatewayServices } from './gateway-rust-config.js';

const STARTUP_TIMEOUT_MS = 8_000;
const SHUTDOWN_TIMEOUT_MS = 8_000;

export function spawnRustGatewayProcess(
  _args: SdCliArgs,
  socketPath: string,
  storePath: string,
  logPath: string,
) {
  const command = rustGatewayCommand();
  const log = openSync(logPath, 'a');
  const child = spawn(
    command.bin,
    [...command.args, '--socket', socketPath, '--store', storePath],
    {
      cwd: command.cwd,
      detached: true,
      stdio: ['ignore', log, log],
    },
  );
  closeSync(log);
  if (!child.pid) throw new Error('failed to spawn rust gateway daemon');
  child.unref();
  return child;
}

export async function waitForRustGateway(socketPath: string): Promise<void> {
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

export async function registerConfiguredServices(
  socketPath: string,
  config: SdConfig,
  configPath?: string,
): Promise<void> {
  const client = new RustGatewayClient({ socketPath });
  for (const service of configuredRustGatewayServices(config, configPath)) {
    await client.registerService(service);
  }
}

export async function waitForRustGatewayExit(pid: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < SHUTDOWN_TIMEOUT_MS) {
    if (!isPidAlive(pid)) return;
    await sleep(25);
  }
  throw new Error(`rust gateway ${pid} did not stop within ${SHUTDOWN_TIMEOUT_MS}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
