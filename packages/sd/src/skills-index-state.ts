import type { SdSearchIndex } from './search-index.js';

export type SdSkillIndexState = Partial<{
  index: SdSearchIndex;
  dirty: boolean;
}>;

const skillIndexStates = new WeakMap<object, SdSkillIndexState>();

export function attachSkillSearchIndex(store: object, index: SdSearchIndex): void {
  skillIndexStates.set(store, { index, dirty: true });
}

export function markSkillSearchIndexDirty(store: object): void {
  const state = skillIndexStates.get(store);
  if (state !== undefined) state.dirty = true;
}

export function skillIndexState(store: object): SdSkillIndexState | undefined {
  return skillIndexStates.get(store);
}
