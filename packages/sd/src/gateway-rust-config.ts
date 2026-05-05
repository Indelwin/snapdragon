import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { GatewayServiceSpec } from '@snapdragon-ai/gateway';
import type { SdConfig } from './config.js';

export function configuredRustGatewayServices(
  config: SdConfig,
  configPath?: string,
): GatewayServiceSpec[] {
  return Object.entries(config.gateway?.services ?? {}).map(([name, service]) => ({
    name,
    enabled: service.enabled ?? true,
    intervalMs: service.interval_ms,
    startupDelayMs: service.startup_delay_ms,
    restart: service.restart,
    budget:
      service.max_fuel !== undefined || service.timeout_ms !== undefined
        ? { maxFuel: service.max_fuel, timeoutMs: service.timeout_ms }
        : undefined,
    worker: sdGatewayWorkerSpec(name, configPath),
  }));
}

function sdGatewayWorkerSpec(name: string, configPath?: string): GatewayServiceSpec['worker'] {
  const args = [...process.execArgv, sdCliEntrypoint(), 'gateway', 'worker', 'run', name];
  if (configPath) args.push('--config', configPath);
  return {
    command: process.execPath,
    args,
    cwd: process.cwd(),
  };
}

function sdCliEntrypoint(): string {
  const compiled = fileURLToPath(new URL('./cli.js', import.meta.url));
  if (existsSync(compiled)) return compiled;
  const source = fileURLToPath(new URL('./cli.ts', import.meta.url));
  return existsSync(source) ? source : compiled;
}
