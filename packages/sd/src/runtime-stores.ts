import type { SdConfig } from './config.js';
import type { SdExtensionRuntime } from './extension-runtime.js';
import { createSdGatewayChannelStore } from './gateway-channels.js';
import { createSdMemoryStore } from './memory.js';
import type { SdProfileInfo } from './profile.js';
import { attachSdSearchIndex } from './search-index-runtime.js';
import { createSdSkillStore } from './skills.js';
import { createSdTodoStore } from './todo.js';

export function createIndexedRuntimeStores(
  config: SdConfig,
  profile: SdProfileInfo | undefined,
  extensionRuntime: SdExtensionRuntime,
) {
  const skills = createSdSkillStore(config, profile, extensionRuntime.skillRoots);
  const memory = createSdMemoryStore(config, profile, extensionRuntime.memoryProviders);
  const todo = createSdTodoStore(config, profile);
  const channels = createSdGatewayChannelStore(config);
  attachSdSearchIndex(config, profile, memory, skills);
  return { skills, memory, todo, channels };
}
