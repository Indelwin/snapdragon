import type { SdCliArgs } from './args-types.js';
import type { SdBackgroundChat } from './background.js';
import { loadSdConfig, loadSdEnvironment } from './config.js';
import { activateSdExtensions } from './extension-runtime.js';
import { createSdExtensionStore } from './extensions.js';
import { ensureFirstPartyExtensionsForConfig, ensureFirstPartyProfile } from './first-party.js';
import { gatewayAgentJobService } from './gateway-agent-job-service.js';
import { runHeadlessGatewayAgent } from './gateway-headless-agent.js';
import { gatewayLearnJobService } from './gateway-learn-job-service.js';
import type { SdProfileInfo } from './profile.js';
import { SdProfileStore } from './profile.js';
import { resolveSdRuntimeConfig } from './profile-runtime.js';
import { configuredBackgroundServices, defaultSdBackgroundServices } from './runtime-background.js';
import { normalizeRuntimeOptions } from './runtime-options.js';
import { createIndexedRuntimeStores } from './runtime-stores.js';
import {
  defaultSessionIndexRootFor,
  resolveSdSessionIndexPath,
  SdSessionIndex,
  sessionIndexEnabled,
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
  const logs: string[] = [];

  const sessionIndexResolution = resolveSessionIndexForWorker(name, config);
  if (sessionIndexResolution.disabled) {
    return { service: name, summary: `${name} disabled`, metrics: {}, logs };
  }
  const sessionIndex = sessionIndexResolution.index;
  try {
    const service = serviceByName(name, config, sessionIndex);
    if (!service) throw new Error(`Unknown gateway service: ${name}`);
    const chat = tryBackgroundChat(config, args);
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

/**
 * Decide whether a worker run for `name` needs a live session index, and open
 * it strictly when so. Returning `{ disabled: true }` lets the caller emit a
 * clean "disabled" result instead of falling through to an "unknown service"
 * error. A SQLite open failure here propagates as a real error rather than
 * being swallowed into `undefined` (which is what the previous best-effort
 * `openSdSessionIndex` did, masking real faults as "Unknown gateway service").
 */
export function resolveSessionIndexForWorker(
  name: string,
  config: Awaited<ReturnType<typeof loadSdConfig>>,
): { disabled: false; index: SdSessionIndex | undefined } | { disabled: true; index?: never } {
  if (name !== 'session-index') return { disabled: false, index: undefined };
  if (!sessionIndexEnabled(config)) return { disabled: true };
  return { disabled: false, index: SdSessionIndex.open(resolveSdSessionIndexPath(config)) };
}

function serviceByName(
  name: string,
  config: Awaited<ReturnType<typeof loadSdConfig>>,
  sessionIndex: SdSessionIndex | undefined,
) {
  const services = [
    ...defaultSdBackgroundServices(),
    gatewayAgentJobService(),
    gatewayLearnJobService(),
  ];
  if (sessionIndex) {
    services.push(
      sessionIndexService({ index: sessionIndex, rootFor: defaultSessionIndexRootFor() }),
    );
  }
  return configuredBackgroundServices(services, config).find((service) => service.name === name);
}

function tryBackgroundChat(
  config: Awaited<ReturnType<typeof loadSdConfig>>,
  args: SdCliArgs,
): SdBackgroundChat {
  return async (messages) => {
    const result = await runHeadlessGatewayAgent(
      {
        prompt: messages
          .map(
            (message) =>
              `${message.role}: ${
                typeof message.content === 'string'
                  ? message.content
                  : JSON.stringify(message.content)
              }`,
          )
          .join('\n\n'),
        provider: config.default_provider,
        model: config.providers?.[config.default_provider ?? '']?.model,
        session: 'new',
      },
      args,
    );
    return { content: result.content };
  };
}
