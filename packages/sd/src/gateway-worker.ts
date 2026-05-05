import type { SdCliArgs } from './args-types.js';
import { loadSdConfig, loadSdEnvironment } from './config.js';
import { activateSdExtensions } from './extension-runtime.js';
import { createSdExtensionStore } from './extensions.js';
import { ensureFirstPartyExtensionsForConfig, ensureFirstPartyProfile } from './first-party.js';
import type { SdProfileInfo } from './profile.js';
import { SdProfileStore } from './profile.js';
import { resolveSdRuntimeConfig } from './profile-runtime.js';
import { makeSdProvider } from './provider.js';
import {
  backgroundChatFromProvider,
  configuredBackgroundServices,
  defaultSdBackgroundServices,
} from './runtime-background.js';
import { normalizeRuntimeOptions } from './runtime-options.js';
import { createIndexedRuntimeStores } from './runtime-stores.js';
import {
  defaultSessionIndexRootFor,
  openSdSessionIndex,
  type SdSessionIndex,
  sessionIndexService,
} from './session-index.js';

export interface GatewayWorkerRunOutput {
  service: string;
  summary?: string;
  metrics?: Record<string, number>;
  logs?: string[];
}

export async function gatewayWorkerCommand(
  action: string,
  rest: string[],
  args: SdCliArgs,
): Promise<string> {
  if (action !== 'run') return `Unknown gateway worker command: ${action}\n`;
  const service = rest[0];
  if (!service) throw new Error('gateway worker run requires a service name');
  return `${JSON.stringify(await runGatewayWorkerService(service, args))}\n`;
}

export async function runGatewayWorkerService(
  name: string,
  args: SdCliArgs,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayWorkerRunOutput> {
  await loadSdEnvironment(undefined, env);
  const options = normalizeRuntimeOptions({ ...args, noBackground: true, noSession: true });
  const baseConfig = await loadSdConfig(options.configPath);
  const profileStore = new SdProfileStore({ root: options.profileRoot });
  const profile = resolveGatewayWorkerProfile(options, profileStore);
  const { config } = resolveSdRuntimeConfig(baseConfig, profile, {
    provider: options.provider,
    model: options.model,
  });

  ensureFirstPartyExtensionsForConfig(config);
  const extensions = createSdExtensionStore(config, profile);
  const extensionRuntime = await activateSdExtensions({
    store: extensions,
    config,
    profile,
    runtimeOptions: options,
    env,
  });
  const stores = createIndexedRuntimeStores(config, profile, extensionRuntime);
  const sessionIndex = openSdSessionIndex(config);
  const logs: string[] = [];
  try {
    const service = serviceByName(name, config, sessionIndex);
    if (!service) throw new Error(`Unknown gateway service: ${name}`);
    const chat = tryBackgroundChat(config, env, extensionRuntime.providers);
    const ctx = {
      config,
      memory: stores.memory,
      profile,
      skills: stores.skills,
      channels: stores.channels,
      chat,
      now: () => Date.now(),
      log: (line: string) => logs.push(line),
    };
    if (service.enabled?.(ctx) === false) {
      return { service: name, summary: `${name} disabled`, metrics: {}, logs };
    }
    const result = await service.runOnce(ctx);
    return {
      service: name,
      summary: result?.summary,
      metrics: result?.metrics,
      logs,
    };
  } finally {
    sessionIndex?.close();
  }
}

function resolveGatewayWorkerProfile(
  options: ReturnType<typeof normalizeRuntimeOptions>,
  store: SdProfileStore,
): SdProfileInfo | undefined {
  if (options.noProfile) return undefined;
  const name = options.profileName ?? store.activeName();
  if (!name) return undefined;
  ensureFirstPartyProfile(store.root, name);
  return store.load(name);
}

function serviceByName(
  name: string,
  config: Awaited<ReturnType<typeof loadSdConfig>>,
  sessionIndex: SdSessionIndex | undefined,
) {
  const services = defaultSdBackgroundServices();
  if (sessionIndex) {
    services.push(
      sessionIndexService({ index: sessionIndex, rootFor: defaultSessionIndexRootFor() }),
    );
  }
  return configuredBackgroundServices(services, config).find((service) => service.name === name);
}

function tryBackgroundChat(
  config: Awaited<ReturnType<typeof loadSdConfig>>,
  env: NodeJS.ProcessEnv,
  providers: Parameters<typeof makeSdProvider>[3],
) {
  try {
    return backgroundChatFromProvider(makeSdProvider(config, {}, env, providers));
  } catch {
    return undefined;
  }
}
