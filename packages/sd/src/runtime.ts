import { createCodingReplAgent, type SnapdragonAgent } from '@snapdragon-ai/agent';
import { normalizeToolsetsConfig } from '@snapdragon-ai/config';
import type { JsonlSession } from '@snapdragon-ai/session';
import { skillToolset } from '@snapdragon-ai/tools';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig, loadSdEnvironment, type SdConfig } from './config.js';
import { type SdProfileInfo, SdProfileStore } from './profile.js';
import { resolveSdRuntimeConfig } from './profile-runtime.js';
import { makeSdProvider, type SdProviderRuntime } from './provider.js';
import { normalizeRuntimeOptions, type SdRuntimeOptions } from './runtime-options.js';
import { createRuntimeSession, sessionRoot } from './runtime-session.js';
import { createSdSkillStore, type SdSkillStore } from './skills.js';

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
  systemPrompt?: string;
  options: SdRuntimeOptions;
  env: NodeJS.ProcessEnv;
}

export async function createSdRuntime(
  args: SdRuntimeOptions | SdCliArgs,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SdRuntime> {
  const options = normalizeRuntimeOptions(args);
  await loadSdEnvironment(undefined, env);
  const baseConfig = await loadSdConfig(options.configPath);
  const profileStore = new SdProfileStore({ root: options.profileRoot });
  const profile = resolveRuntimeProfile(options, profileStore);
  const { config, systemPrompt } = resolveSdRuntimeConfig(baseConfig, profile, {
    provider: options.provider,
    model: options.model,
  });
  const provider = makeSdProvider(config, {}, env);
  const session = createRuntimeSession(options, config, provider);
  const skills = createSdSkillStore(config, profile);
  const agent = await createSdAgent(options, config, provider, session, skills, systemPrompt);
  return {
    agent,
    baseConfig,
    config,
    provider,
    profile,
    profileStore,
    session,
    sessionRoot: session ? sessionRoot(config) : undefined,
    skills,
    systemPrompt,
    options,
    env,
  };
}

export async function createSdAgent(
  options: SdRuntimeOptions,
  config: SdConfig,
  provider: SdProviderRuntime,
  session: JsonlSession | undefined,
  skills: SdSkillStore,
  systemPrompt?: string,
): Promise<SnapdragonAgent> {
  const agent = await createCodingReplAgent({
    provider: provider.handler,
    cwd: options.cwd,
    session,
    systemPrompt,
    maxTurns: config.agent?.max_turns,
    temperature: config.agent?.temperature,
    maxTokens: config.agent?.max_tokens,
    reasoning: config.agent?.reasoning ?? provider.reasoning,
  });
  await agent.registry.register(
    skillToolset({ catalog: skills, authoring: config.skills?.authoring ?? true }),
  );
  const toolsets = normalizeToolsetsConfig(config.toolsets);
  agent.registry.applyConfig({
    enabled: toolsets.enabled,
    disabled: toolsets.disabled,
    allowedTools: toolsets.allowedTools,
    deniedTools: toolsets.deniedTools,
  });
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
export { normalizeRuntimeOptions, type SdRuntimeOptions } from './runtime-options.js';
