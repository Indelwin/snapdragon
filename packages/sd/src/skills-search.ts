import type { SkillDescriptor } from '@snapdragon-ai/content';
import type { IndexedSkill } from './skills.js';
import { searchSkillIndex } from './skills-index.js';

export function searchSkills(
  store: object,
  skills: readonly IndexedSkill[],
  query: string,
  limit: number,
): SkillDescriptor[] {
  const indexed = searchSkillIndex(store, skills, query, limit);
  if (indexed !== undefined) return indexed;
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return skills.slice(0, limit).map(toSkillDescriptor);
  return skills
    .map((skill) => ({ skill, score: scoreSkill(skill, words) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id))
    .slice(0, limit)
    .map((entry) => toSkillDescriptor(entry.skill));
}

export function toSkillDescriptor(skill: IndexedSkill): SkillDescriptor {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    command: skill.command,
    aliases: skill.aliases,
    category: skill.category,
    tags: skill.tags,
    source: skill.source,
    sourceRoot: skill.sourceRoot,
    writable: skill.writable,
    path: skill.path,
    dir: skill.dir,
  };
}

function scoreSkill(skill: IndexedSkill, words: string[]): number {
  const haystack = [
    skill.id,
    skill.name,
    skill.description,
    skill.category,
    skill.command,
    ...skill.aliases,
    ...skill.tags,
  ]
    .join(' ')
    .toLowerCase();
  return words.reduce((score, word) => score + wordScore(haystack, word), 0);
}

function wordScore(haystack: string, word: string): number {
  if (haystack.includes(word)) return 1;
  return 0;
}
