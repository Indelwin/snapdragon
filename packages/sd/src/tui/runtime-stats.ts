import type { JsonObject } from '@snapdragon-ai/ui';
import type { SdRuntime } from '../runtime.js';
import { countMemoriesSafely, countSessionsSafely } from './runtime-counts.js';
import { gitStatus } from './runtime-git-status.js';

export function runtimeStats(runtime: SdRuntime): JsonObject {
  const reasoning = runtime.config.agent?.reasoning;
  return {
    tools: runtime.agent.registry.listDefinitions().length,
    skills: runtime.skills.list().length,
    profiles: runtime.profileStore.list().length,
    services: runtime.background.list().length,
    extensions: runtime.extensions.list().length,
    sessions: countSessionsSafely(runtime),
    memories: countMemoriesSafely(runtime),
    git: gitStatus(runtime.agent.cwd),
    reasoning: reasoning?.enabled === false ? 'off' : (reasoning?.effort ?? 'medium'),
    contextTokens: runtime.config.agent?.context?.max_request_tokens ?? null,
    outputTokens: runtime.config.agent?.max_tokens ?? null,
  };
}
