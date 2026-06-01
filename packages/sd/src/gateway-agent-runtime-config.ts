import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  GatewayAgentRuntimeDescriptor,
  GatewayAgentRuntimeIsolation,
  GatewayAgentRuntimeKind,
  GatewayAgentRuntimeProtocol,
} from '@snapdragon-ai/gateway';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { DEFAULT_SD_CONFIG_PATH, LEGACY_SD_CONFIG_PATH } from './config-constants.js';
import { configPathForLoad } from './config-path.js';
import type {
  SdGatewayAgentRuntimeConfig,
  SdGatewayAgentRuntimeIsolation,
  SdGatewayAgentRuntimeKind,
  SdGatewayAgentRuntimeProtocol,
} from './config-runtime-types.js';
import type { SdConfig } from './config-schema.js';

const runtimeKinds: ReadonlySet<GatewayAgentRuntimeKind> = new Set([
  'sd',
  'codex',
  'hermes',
  'pi',
  'custom',
]);
const runtimeProtocols: ReadonlySet<GatewayAgentRuntimeProtocol> = new Set([
  'embedded',
  'command',
  'jsonl',
  'http',
  'stdio',
]);
const runtimeIsolations: ReadonlySet<GatewayAgentRuntimeIsolation> = new Set([
  'inherit',
  'profile',
  'channel',
  'sandbox',
]);

export function configuredAgentRuntimeDescriptors(
  config: SdConfig,
): GatewayAgentRuntimeDescriptor[] {
  return Object.entries(config.gateway?.agent_runtimes ?? {})
    .map(([id, runtime]) => runtimeDescriptorFromConfig(id, runtime))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function configuredAgentRuntime(
  config: SdConfig,
  id: string,
): GatewayAgentRuntimeDescriptor | undefined {
  const runtime = config.gateway?.agent_runtimes?.[id];
  return runtime ? runtimeDescriptorFromConfig(id, runtime) : undefined;
}

export function mergeAgentRuntimeDescriptors(
  saved: GatewayAgentRuntimeDescriptor[],
  registered: GatewayAgentRuntimeDescriptor[],
): GatewayAgentRuntimeDescriptor[] {
  const runtimes = new Map<string, GatewayAgentRuntimeDescriptor>();
  for (const runtime of saved) runtimes.set(runtime.id, runtime);
  for (const runtime of registered) runtimes.set(runtime.id, runtime);
  return [...runtimes.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function saveAgentRuntimeToConfig(
  path: string,
  descriptor: GatewayAgentRuntimeDescriptor,
): Promise<string> {
  const configPath = configPathForLoad(path, LEGACY_SD_CONFIG_PATH, DEFAULT_SD_CONFIG_PATH);
  const parsed = await readConfigForEdit(configPath);
  const gateway = parsed.gateway ?? {};
  parsed.gateway = {
    ...gateway,
    agent_runtimes: {
      ...(gateway.agent_runtimes ?? {}),
      [descriptor.id]: runtimeConfigFromDescriptor(descriptor),
    },
  };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, stringifyYaml(parsed), 'utf8');
  return configPath;
}

function runtimeDescriptorFromConfig(
  id: string,
  config: SdGatewayAgentRuntimeConfig,
): GatewayAgentRuntimeDescriptor {
  return {
    id,
    kind: enumValue('kind', config.kind, runtimeKinds),
    protocol: enumValue('protocol', config.protocol, runtimeProtocols),
    label: config.label,
    command: config.command,
    supportedJobKinds: config.supported_job_kinds ?? [],
    capabilities: config.capabilities ?? [],
    isolation: config.isolation
      ? enumValue('isolation', config.isolation, runtimeIsolations)
      : undefined,
    health: config.health
      ? {
          state: config.health.state,
          checkedAtMs: config.health.checked_at_ms ?? 0,
          message: config.health.message,
        }
      : undefined,
    metadata: config.metadata,
  };
}

function runtimeConfigFromDescriptor(
  descriptor: GatewayAgentRuntimeDescriptor,
): SdGatewayAgentRuntimeConfig {
  return {
    kind: descriptor.kind as SdGatewayAgentRuntimeKind,
    protocol: descriptor.protocol as SdGatewayAgentRuntimeProtocol,
    label: descriptor.label,
    command: descriptor.command,
    supported_job_kinds: descriptor.supportedJobKinds,
    capabilities: descriptor.capabilities,
    isolation: descriptor.isolation as SdGatewayAgentRuntimeIsolation | undefined,
    health: descriptor.health
      ? {
          state: descriptor.health.state,
          checked_at_ms: descriptor.health.checkedAtMs,
          message: descriptor.health.message,
        }
      : undefined,
    metadata: descriptor.metadata,
  };
}

async function readConfigForEdit(path: string): Promise<Partial<SdConfig> & { version: 1 }> {
  if (!existsSync(path)) return { version: 1 };
  const parsed = parseYaml(await readFile(path, 'utf8')) as Partial<SdConfig> | null;
  if (!parsed || parsed.version !== 1) {
    throw new Error(`Unsupported sd config at ${path}; expected version: 1`);
  }
  return parsed as Partial<SdConfig> & { version: 1 };
}

function enumValue<T extends string>(field: string, value: string, allowed: ReadonlySet<T>): T {
  if (allowed.has(value as T)) return value as T;
  throw new Error(`Invalid gateway agent runtime ${field}: ${value}`);
}
