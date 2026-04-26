import { createCodingReplAgent, type SnapdragonAgent } from '@snapdragon-ai/agent';
import { normalizeToolsetsConfig } from '@snapdragon-ai/config';
import { type JsonlSession, SessionStore } from '@snapdragon-ai/session';
import type { SdCliArgs } from './args.js';
import {
  DEFAULT_SD_SESSION_ROOT,
  loadSdConfig,
  loadSdEnvironment,
  type SdConfig,
} from './config.js';
import { makeSdProvider, type SdProviderRuntime } from './provider.js';

export interface SdRuntime {
  agent: SnapdragonAgent;
  config: SdConfig;
  provider: SdProviderRuntime;
  session?: JsonlSession;
  sessionRoot?: string;
}

export async function createSdRuntime(
  args: SdCliArgs,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SdRuntime> {
  await loadSdEnvironment(undefined, env);
  const config = await loadSdConfig(args.configPath);
  const provider = makeSdProvider(config, { provider: args.provider, model: args.model }, env);
  const session = createSession(args, config, provider);
  const agent = await createCodingReplAgent({
    provider: provider.handler,
    cwd: args.cwd,
    session,
    maxTurns: config.agent?.max_turns,
    temperature: config.agent?.temperature,
    maxTokens: config.agent?.max_tokens,
    reasoning: config.agent?.reasoning ?? provider.reasoning,
  });
  const toolsets = normalizeToolsetsConfig(config.toolsets);
  agent.registry.applyConfig({
    enabled: toolsets.enabled,
    disabled: toolsets.disabled,
    allowedTools: toolsets.allowedTools,
    deniedTools: toolsets.deniedTools,
  });

  return {
    agent,
    config,
    provider,
    session,
    sessionRoot: session ? sessionRoot(config) : undefined,
  };
}

function createSession(
  args: SdCliArgs,
  config: SdConfig,
  provider: SdProviderRuntime,
): JsonlSession | undefined {
  if (args.noSession || config.sessions?.enabled === false) return undefined;
  const store = new SessionStore({ root: sessionRoot(config) });
  const meta = {
    app: 'sd',
    provider: provider.id,
    model: provider.model,
    cwd: args.cwd,
  };
  if (args.newSession) {
    return store.create(args.sessionId ?? SessionStore.generateId(), meta);
  }
  if (args.sessionId) return store.openOrCreate(args.sessionId, meta);
  return store.create(SessionStore.generateId(), meta);
}

function sessionRoot(config: SdConfig): string {
  return config.sessions?.root ?? DEFAULT_SD_SESSION_ROOT;
}
