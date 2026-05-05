import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { configuredServiceList } from './gateway-command-services-format.js';
import {
  rustRunService,
  rustServiceList,
  syncRustServiceEnabled,
} from './gateway-command-services-rust.js';

export async function servicesCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  if (action === 'list') return serviceList(args);
  if (action === 'run') return runService(rest[0], args);
  if (action === 'enable' || action === 'disable') {
    return setServiceEnabled(rest[0], action === 'enable', args.configPath);
  }
  return `Unknown gateway services command: ${action}\n`;
}

async function serviceList(args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  if (config.gateway?.runtime !== 'inline-ts') return rustServiceList(config);
  return configuredServiceList(config);
}

async function runService(name: string | undefined, args: SdCliArgs): Promise<string> {
  if (!name) return 'gateway services run requires a service name\n';
  const config = await loadSdConfig(args.configPath);
  if (config.gateway?.runtime !== 'inline-ts') return rustRunService(name, config);
  const { createSdRuntime, stopSdRuntime } = await import('./runtime.js');
  const runtime = await createSdRuntime({
    ...args,
    noSession: true,
    noBackground: false,
    backgroundMode: 'inline',
  });
  try {
    const status = await runtime.background.runNow(name);
    return status
      ? `${name}: runs=${status.runs} errors=${status.errors} ${status.last_summary ?? ''}\n`
      : `Unknown gateway service: ${name}\n`;
  } finally {
    stopSdRuntime(runtime);
  }
}

async function setServiceEnabled(
  name: string | undefined,
  enabled: boolean,
  configPath: string,
): Promise<string> {
  if (!name) return `gateway services ${enabled ? 'enable' : 'disable'} requires a service name\n`;
  const config = await loadSdConfig(configPath);
  const rustRuntime = config.gateway?.runtime !== 'inline-ts';
  config.gateway = {
    ...(config.gateway ?? {}),
    services: {
      ...(config.gateway?.services ?? {}),
      [name]: {
        ...(config.gateway?.services?.[name] ?? {}),
        enabled,
      },
    },
  };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, stringifyYaml(config), 'utf8');
  const action = enabled ? 'Enabled' : 'Disabled';
  if (!rustRuntime) return `${action} gateway service ${name}\n`;
  return syncRustServiceEnabled(config, name, enabled, action);
}
