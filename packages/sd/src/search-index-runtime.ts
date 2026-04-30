import type { SdConfig } from './config.js';
import { resolveSdMemoryPath, type SdMemoryProvider, SdMemoryStore } from './memory.js';
import { attachMemorySearchIndex } from './memory-index.js';
import type { SdProfileInfo } from './profile.js';
import { SdSearchIndex } from './search-index.js';
import type { SdSkillStore } from './skills.js';
import { attachSkillSearchIndex } from './skills-index-state.js';

export function attachSdSearchIndex(
  config: SdConfig,
  profile: SdProfileInfo | undefined,
  memory: SdMemoryProvider,
  skills: SdSkillStore,
): void {
  if (!(memory instanceof SdMemoryStore)) return;
  try {
    const memoryPath = resolveSdMemoryPath(config, profile);
    const index = SdSearchIndex.open(memoryPath.replace(/\.md$/i, '.index.sqlite'));
    attachMemorySearchIndex(memory, index);
    attachSkillSearchIndex(skills, index);
  } catch {
    // Search indexing is best-effort; stores retain their substring fallback.
  }
}
