import type { JsonlSession, SdSessionIndex } from '@snapdragon-ai/session';
import type { SdConfig } from './config.js';
import { activateSdExtensions } from './extension-runtime.js';
import { createSdExtensionStore } from './extensions.js';
import { ensureFirstPartyExtensionsForConfig } from './first-party.js';
import type { SdProfileInfo } from './profile.js';
import { resolveSdRuntimeConfig, type SdRuntimeCliOverrides } from './profile-runtime.js';
import { makeSdProvider } from './provider.js';
import type { SdRuntime } from './runtime.js';
import { createSdAgent } from './runtime.js';
import { replaceRuntimeBackground } from './runtime-background.js';
import { sessionRoot } from './runtime-session.js';
import { ensureRuntimeSessionMeta } from './runtime-session-meta-record.js';
import { createIndexedRuntimeStores } from './runtime-stores.js';
import {
  openSdSessionIndex,
  resolveSdSessionIndexPath,
  sessionIndexEnabled,
} from './session-index.js';

interface RuntimeRebuildRequest {
  profile?: SdProfileInfo;
  session?: JsonlSession;
  overrides: SdRuntimeCliOverrides;
  warnings?: string[];
}

export async function applyRuntimeRebuild(
  runtime: SdRuntime,
  request: RuntimeRebuildRequest,
): Promise<void> {
  const { config, systemPrompt } = resolveSdRuntimeConfig(
    runtime.baseConfig,
    request.profile,
    request.overrides,
  );
  ensureFirstPartyExtensionsForConfig(config);
  const extensions = createSdExtensionStore(config, request.profile);
  const extensionRuntime = await activateSdExtensions({
    store: extensions,
    config,
    profile: request.profile,
    runtimeOptions: runtime.options,
    env: runtime.env,
  });
  const provider = makeSdProvider(config, {}, runtime.env, extensionRuntime.providers);
  const { skills, memory, todo, channels } = createIndexedRuntimeStores(
    config,
    request.profile,
    extensionRuntime,
  );
  const sessionIndex = sessionIndexForRebuild(runtime, config);
  const agent = await createSdAgent(
    runtime.options,
    config,
    provider,
    request.session,
    skills,
    memory,
    todo,
    extensionRuntime,
    systemPrompt,
    sessionIndex,
  );
  const background = replaceRuntimeBackground(
    {
      background: runtime.background,
      sessionIndex: runtime.sessionIndex,
      options: runtime.options,
    },
    {
      config,
      provider,
      profile: request.profile,
      skills,
      channels,
      memory,
      sessionIndex,
    },
  );
  Object.assign(runtime, {
    config,
    provider,
    agent,
    background,
    profile: request.profile,
    session: request.session,
    skills,
    channels,
    memory,
    todo,
    sessionIndex,
    extensions,
    extensionRuntime,
    systemPrompt,
    warnings: request.warnings ?? [],
  });
  runtime.sessionRoot = request.session ? sessionRoot(config) : undefined;
  ensureRuntimeSessionMeta(request.session, runtime.options, provider, request.profile);
}

export function sessionIndexForRebuild(
  runtime: SdRuntime,
  config: SdConfig,
): SdSessionIndex | undefined {
  if (!sessionIndexEnabled(config)) return undefined;
  const path = resolveSdSessionIndexPath(config);
  return runtime.sessionIndex?.path === path ? runtime.sessionIndex : openSdSessionIndex(config);
}

// `replaceRuntimeBackground` lives in `./runtime-background.ts` to keep the
// rebind/restart split colocated with `startRuntimeBackgroundServices`.
