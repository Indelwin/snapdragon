import type { SkillDescriptor } from '@snapdragon-ai/content';
import type { IndexedSkill } from './skills.js';
import { skillIndexState } from './skills-index-state.js';
import { syncSkillIndex } from './skills-index-sync.js';

export function searchSkillIndex(
  store: object,
  skills: readonly IndexedSkill[],
  query: string,
  limit: number,
): SkillDescriptor[] | undefined {
  const state = skillIndexState(store);
  if (state === undefined) return undefined;
  const index = state.index;
  if (index === undefined) return undefined;
  try {
    syncSkillIndex(state, skills);
    const trimmed = query.trim();
    if (trimmed.length === 0) return undefined;
    const byId = new Map(skills.map((skill) => [skill.id, skill]));
    return index
      .search(trimmed, 'skill', { limit, touch: true })
      .flatMap((hit) => descriptorForHit(byId, hit.id));
  } catch {
    return undefined;
  }
}

function descriptorForHit(
  skills: ReadonlyMap<string, IndexedSkill>,
  id: string,
): SkillDescriptor[] {
  const skill = skills.get(id);
  if (skill === undefined) return [];
  return [skill];
}
