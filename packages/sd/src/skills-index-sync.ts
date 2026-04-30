import type { IndexedSkill } from './skills.js';
import type { SdSkillIndexState } from './skills-index-state.js';

export function syncSkillIndex(state: SdSkillIndexState, skills: readonly IndexedSkill[]): void {
  const index = state.index;
  if (index === undefined) return;
  if (state.dirty !== true) return;
  index.sync(
    'skill',
    skills.map((skill) => ({
      kind: 'skill',
      id: skill.id,
      title: skill.name,
      description: skill.description,
      body: skill.body,
      tags: skill.tags,
      source: skill.source,
      path: skillPath(skill),
    })),
  );
  state.dirty = false;
}

function skillPath(skill: IndexedSkill): string {
  if (skill.path !== undefined) return skill.path;
  if (skill.dir !== undefined) return skill.dir;
  return `skill:${skill.id}`;
}
