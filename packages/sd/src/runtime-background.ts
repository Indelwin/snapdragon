import type { SdBackgroundChat, SdBackgroundService } from './background.js';
import { startSdBackgroundServices } from './background.js';
import type { SdConfig } from './config.js';
import type { SdMemoryProvider } from './memory.js';
import { memoryWorkerService } from './memory-worker.js';
import type { SdProfileInfo } from './profile.js';
import type { SdProviderRuntime } from './provider.js';
import type { SdRuntimeOptions } from './runtime-options.js';
import { skillBuilderService } from './skill-builder.js';
import type { SdSkillStore } from './skills.js';

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
) {
  return startSdBackgroundServices(defaultSdBackgroundServices(), {
    config,
    memory,
    profile,
    skills,
    chat: backgroundChatFromProvider(provider),
    disableAll: options.noBackground,
    disable: collectDisabledServices(options),
  });
}
