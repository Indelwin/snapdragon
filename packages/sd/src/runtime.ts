import { createCodingReplAgent, type SnapdragonAgent } from '@snapdragon-ai/agent';
import type { JsonlSession, SdSessionIndex } from '@snapdragon-ai/session';
import type { SdCliArgs } from './args-types.js';
import type { SdBackgroundServicesHandle } from './background.js';
import { loadSdConfig, loadSdEnvironment, type SdConfig } from './config.js';
import { activateSdExtensions, type SdExtensionRuntime } from './extension-runtime.js';
import { createSdExtensionStore, type SdExtensionStore } from './extensions.js';
import { ensureFirstPartyExtensionsForConfig, ensureFirstPartyProfile } from './first-party.js';
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
  memory: SdMemoryProvider;
  todo: SdTodoStore;
  sessionIndex?: SdSessionIndex;
  background: SdBackgroundServicesHandle;
  extensions: SdExtensionStore;
  extensionRuntime: SdExtensionRuntime;
  systemPrompt?: string;
  options: SdRuntimeOptions;
  env: NodeJS.ProcessEnv;
  warnings: string[];
}

export function stopSdRuntime(runtime: SdRuntime): void {
  runtime.background.stop();
  runtime.sessionIndex?.close();
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
  const extensions = createSdExtensionStore(config, profile);
  const extensionRuntime = await activateSdExtensions({
    store: extensions,
    config,
    profile,
    runtimeOptions: options,
    env,
  });
  const provider = makeSdProvider(config, {}, env, extensionRuntime.providers);
  const session = initialRuntimeSession(plan.sessionSelection, options, config, provider, profile);
  ensureRuntimeSessionMeta(session, options, provider, profile);
  const { skills, memory, todo } = createIndexedRuntimeStores(config, profile, extensionRuntime);
  const sessionIndex = openSdSessionIndex(config);
  return finishRuntime({
    baseConfig,
    config,
    env,
    extensions,
    extensionRuntime,
    memory,
    provider,
    profile,
    profileStore,
    session,
    skills,
    todo,
    sessionIndex,
    systemPrompt,
    options,
    warnings: plan.warnings,
  });
}

async function finishRuntime(
  parts: Omit<SdRuntime, 'agent' | 'background' | 'sessionRoot'>,
): Promise<SdRuntime> {
  const background = startRuntimeBackgroundServices(
    parts.options,
    parts.config,
    parts.provider,
    parts.profile,
    parts.skills,
    parts.memory,
    parts.sessionIndex,
  );
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
    context: contextOptions(config, provider),
    temperature: config.agent?.temperature,
    maxTokens: config.agent?.max_tokens,
    reasoning: config.agent?.reasoning ?? provider.reasoning,
  });
  const runtimeToolsets = { agent, config, skills, memory, todo, sessionIndex, extensionRuntime };
  await registerRuntimeToolsets(runtimeToolsets);
  return agent;
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
