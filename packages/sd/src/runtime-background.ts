import type { SdSessionIndex } from '@snapdragon-ai/session';
import type {
  SdBackgroundChat,
  SdBackgroundService,
  SdBackgroundServicesHandle,
} from './background.js';
import { startSdBackgroundServices } from './background.js';
import type { SdConfig } from './config.js';
import type { SdMemoryProvider } from './memory.js';
import { memoryWorkerService } from './memory-worker.js';
import type { SdProfileInfo } from './profile.js';
import type { SdProviderRuntime } from './provider.js';
import type { SdRuntimeOptions } from './runtime-options.js';
import { defaultSessionIndexRootFor, sessionIndexService } from './session-index.js';
import { skillBuilderService } from './skill-builder.js';
import type { SdSkillStore } from './skills.js';

export interface RuntimeBackgroundParts {
  config: SdConfig;
  provider: SdProviderRuntime;
  profile?: SdProfileInfo;
  skills: SdSkillStore;
  memory: SdMemoryProvider;
  sessionIndex?: SdSessionIndex;
}

export function backgroundChatFromProvider(provider: SdProviderRuntime): SdBackgroundChat {
  return async (messages, options) => {
    const response = await provider.handler(
      {
        role: 'assistant',
        messages,
        max_tokens: options?.max_tokens ?? 2000,
      },
      {
        runId: `bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        emit: () => undefined,
      },
    );
    return { content: response.content };
  };
}

export function defaultSdBackgroundServices(): SdBackgroundService[] {
  return [memoryWorkerService(), skillBuilderService()];
}

export function collectDisabledServices(options: SdRuntimeOptions): string[] {
  const disabled: string[] = [];
  if (options.noMemoryWorker) disabled.push('memory-worker');
  return disabled;
}

export function startRuntimeBackgroundServices(
  options: SdRuntimeOptions,
  config: SdConfig,
  provider: SdProviderRuntime,
  profile: SdProfileInfo | undefined,
  skills: SdSkillStore,
  memory: SdMemoryProvider,
  sessionIndex?: SdSessionIndex,
) {
  const services = defaultSdBackgroundServices();
  if (sessionIndex) {
    services.push(
      sessionIndexService({ index: sessionIndex, rootFor: defaultSessionIndexRootFor() }),
    );
  }
  return startSdBackgroundServices(services, {
    config,
    memory,
    profile,
    skills,
    chat: backgroundChatFromProvider(provider),
    disableAll: options.noBackground,
    disable: collectDisabledServices(options),
  });
}

/**
 * Hot path: same session-index ref & live gateway ⇒ rebind stores in place.
 * Otherwise (session-index attached/detached/swapped) full restart.
 */
export interface ReplaceRuntimeBackgroundCurrent {
  background: SdBackgroundServicesHandle;
  sessionIndex: SdSessionIndex | undefined;
  options: SdRuntimeOptions;
}

export function replaceRuntimeBackground(
  current: ReplaceRuntimeBackgroundCurrent,
  parts: RuntimeBackgroundParts,
): SdBackgroundServicesHandle {
  if (current.sessionIndex === parts.sessionIndex) {
    current.background.rebindStores({
      config: parts.config,
      memory: parts.memory,
      profile: parts.profile,
      skills: parts.skills,
      chat: backgroundChatFromProvider(parts.provider),
    });
    return current.background;
  }
  current.background.stop();
  if (current.sessionIndex && current.sessionIndex !== parts.sessionIndex) {
    current.sessionIndex.close();
  }
  return startRuntimeBackgroundServices(
    current.options,
    parts.config,
    parts.provider,
    parts.profile,
    parts.skills,
    parts.memory,
    parts.sessionIndex,
  );
}
