import { createCodingReplAgent, type SnapdragonAgent } from '@snapdragon-ai/agent';
import type { JsonlSession, SdSessionIndex } from '@snapdragon-ai/session';
import type { SdCliArgs } from './args-types.js';
import type { SdBackgroundServicesHandle } from './background.js';
import { loadSdConfig, loadSdEnvironment, type SdConfig } from './config.js';
import { activateSdExtensions, type SdExtensionRuntime } from './extension-runtime.js';
import { createSdExtensionStore, type SdExtensionStore } from './extensions.js';
import { ensureFirstPartyExtensionsForConfig, ensureFirstPartyProfile } from './first-party.js';
import type { SdGatewayChannelStore } from './gateway-channels.js';
import type { SdMemoryProvider } from './memory.js';
import { type SdProfileInfo, SdProfileStore } from './profile.js';
import { makeSdProvider, type SdProviderRuntime } from './provider.js';
import { startRuntimeBackgroundServices } from './runtime-background.js';
import { contextOptions } from './runtime-context.js';
import { resolveInitialRuntimePlan } from './runtime-initial-plan.js';
import { initialRuntimeSession } from './runtime-initial-session.js';
import { normalizeRuntimeOptions, type SdRuntimeOptions } from './runtime-options.js';
import { sessionRoot } from './runtime-session.js';
import { ensureRuntimeSessionMeta } from './runtime-session-meta-record.js';
import { createIndexedRuntimeStores } from './runtime-stores.js';
import { registerRuntimeToolsets } from './runtime-toolsets.js';
import type { SdSearchIndex } from './search-index.js';
import { openSdSessionIndex } from './session-index.js';
import type { SdSkillStore } from './skills.js';
import type { SdTodoStore } from './todo.js';

export interface SdRuntime {
  agent: SnapdragonAgent;
  baseConfig: SdConfig;
  config: SdConfig;
  provider: SdProviderRuntime;
  profile?: SdProfileInfo;
  profileStore: SdProfileStore;
  session?: JsonlSession;
  sessionRoot?: string;
  skills: SdSkillStore;
  channels: SdGatewayChannelStore;
  memory: SdMemoryProvider;
  todo: SdTodoStore;
  sessionIndex?: SdSessionIndex;
  searchIndex?: SdSearchIndex;
  background: SdBackgroundServicesHandle;
  extensions: SdExtensionStore;
  extensionRuntime: SdExtensionRuntime;
  systemPrompt?: string;
  options: SdRuntimeOptions;
  env: NodeJS.ProcessEnv;
  warnings: string[];
}

const runtimeDisposals = new WeakMap<SdRuntime, Promise<void>>();

export function stopSdRuntime(runtime: SdRuntime): Promise<void> {
  const existing = runtimeDisposals.get(runtime);
  if (existing) return existing;
  const disposal = disposeRuntimeResources(runtime);
  runtimeDisposals.set(runtime, disposal);
  return disposal;
}

export async function createSdRuntime(
  args: SdRuntimeOptions | SdCliArgs,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SdRuntime> {
  const options = normalizeRuntimeOptions(args);
  await loadSdEnvironment(undefined, env);
  const baseConfig = await loadSdConfig(options.configPath);
  const profileStore = new SdProfileStore({ root: options.profileRoot });
  ensureRequestedFirstPartyProfile(options, profileStore);
  const profile = resolveRuntimeProfile(options, profileStore);
  const plan = resolveInitialRuntimePlan(baseConfig, profile, options);
  const { config, systemPrompt } = plan;
  ensureFirstPartyExtensionsForConfig(config);
  let extensionRuntime: SdExtensionRuntime | undefined;
  let sessionIndex: SdSessionIndex | undefined;
  let searchIndex: SdSearchIndex | undefined;
  try {
    const extensions = createSdExtensionStore(config, profile);
    extensionRuntime = await activateSdExtensions({
      store: extensions,
      config,
      profile,
      runtimeOptions: options,
      env,
    });
    const provider = makeSdProvider(config, {}, env, extensionRuntime.providers);
    const session = initialRuntimeSession(
      plan.sessionSelection,
      options,
      config,
      provider,
      profile,
    );
    ensureRuntimeSessionMeta(session, options, provider, profile);
    const stores = createIndexedRuntimeStores(config, profile, extensionRuntime);
    searchIndex = stores.searchIndex;
    sessionIndex = openSdSessionIndex(config);
    return await finishRuntime({
      baseConfig,
      config,
      env,
      extensions,
      extensionRuntime,
      memory: stores.memory,
      provider,
      profile,
      profileStore,
      session,
      skills: stores.skills,
      channels: stores.channels,
      todo: stores.todo,
      sessionIndex,
      searchIndex,
      systemPrompt,
      options,
      warnings: plan.warnings,
    });
  } catch (error) {
    await Promise.allSettled([
      Promise.resolve().then(() => sessionIndex?.close()),
      Promise.resolve().then(() => searchIndex?.close()),
      extensionRuntime?.dispose(),
    ]);
    throw error;
  }
}

export async function disposeRuntimeResources(
  runtime: Pick<
    SdRuntime,
    'agent' | 'background' | 'sessionIndex' | 'searchIndex' | 'extensionRuntime'
  >,
): Promise<void> {
  const stopped = await Promise.allSettled([
    Promise.resolve().then(() => runtime.background.stop()),
  ]);
  const settled = await Promise.allSettled([
    Promise.resolve().then(() => runtime.agent.dispose()),
    Promise.resolve().then(() => runtime.background.flush()),
    Promise.resolve().then(() => runtime.sessionIndex?.close()),
    Promise.resolve().then(() => runtime.searchIndex?.close()),
    Promise.resolve().then(() => runtime.extensionRuntime.dispose()),
  ]);
  const errors = [...stopped, ...settled]
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (errors.length > 0) throw new AggregateError(errors, 'Runtime disposal failed.');
}

async function finishRuntime(
  parts: Omit<SdRuntime, 'agent' | 'background' | 'sessionRoot'>,
): Promise<SdRuntime> {
  const agent = await createSdAgent(
    parts.options,
    parts.config,
    parts.provider,
    parts.session,
    parts.skills,
    parts.memory,
    parts.todo,
    parts.extensionRuntime,
    parts.systemPrompt,
    parts.sessionIndex,
  );
  let background: SdBackgroundServicesHandle;
  try {
    background = startRuntimeBackgroundServices(
      parts.options,
      parts.config,
      parts.provider,
      parts.profile,
      parts.skills,
      parts.memory,
      parts.channels,
      parts.sessionIndex,
    );
  } catch (error) {
    await agent.dispose();
    throw error;
  }
  return {
    ...parts,
    agent,
    background,
    sessionRoot: parts.session ? sessionRoot(parts.config) : undefined,
  };
}

function ensureRequestedFirstPartyProfile(options: SdRuntimeOptions, store: SdProfileStore): void {
  if (options.noProfile) return;
  const name = options.profileName ?? store.activeName();
  if (name) ensureFirstPartyProfile(store.root, name);
}

export async function createSdAgent(
  options: SdRuntimeOptions,
  config: SdConfig,
  provider: SdProviderRuntime,
  session: JsonlSession | undefined,
  skills: SdSkillStore,
  memory: SdMemoryProvider,
  todo: SdTodoStore,
  extensionRuntime: SdExtensionRuntime,
  systemPrompt?: string,
  sessionIndex?: SdSessionIndex,
): Promise<SnapdragonAgent> {
  const agent = await createCodingReplAgent({
    provider: provider.handler,
    cwd: options.cwd,
    session,
    systemPrompt,
    maxTurns: config.agent?.max_turns,
    maxToolResultBytes: config.agent?.max_tool_result_bytes,
    maxToolCallArgsBytes: config.agent?.max_tool_call_args_bytes,
    context: contextOptions(config, provider),
    temperature: config.agent?.temperature,
    maxTokens: config.agent?.max_tokens,
    reasoning: config.agent?.reasoning ?? provider.reasoning,
  });
  const runtimeToolsets = { agent, config, skills, memory, todo, sessionIndex, extensionRuntime };
  try {
    await registerRuntimeToolsets(runtimeToolsets);
    return agent;
  } catch (error) {
    await agent.dispose();
    throw error;
  }
}

function resolveRuntimeProfile(
  options: SdRuntimeOptions,
  store: SdProfileStore,
): SdProfileInfo | undefined {
  if (options.noProfile) return undefined;
  const name = options.profileName ?? store.activeName();
  return name ? store.load(name) : undefined;
}

export { resolveSdRuntimeConfig } from './profile-runtime.js';
export { defaultSdBackgroundServices } from './runtime-background.js';
export { normalizeRuntimeOptions, type SdRuntimeOptions } from './runtime-options.js';
