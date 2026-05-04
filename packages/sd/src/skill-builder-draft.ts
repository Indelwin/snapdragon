/**
 * LLM-driven SKILL.md drafting + draft directory I/O for the skill-builder.
 * Drafts live in `<skill_root>/.drafts/<id>/SKILL.md`; skill discovery
 * skips `.`-prefixed dirs so they're invisible until accepted.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { Message } from '@snapdragon-ai/host';
import type { SdBackgroundChat } from './background.js';
import type { SdConfig, SdSkillBuilderConfig } from './config.js';
import type { SdProfileInfo } from './profile.js';
import type { CandidateExample, SdSkillPattern } from './skill-builder-types.js';
import { resolveSdSkillRoots } from './skills.js';

export const DRAFTS_DIRNAME = '.drafts';

export interface SdSkillDraft {
  id: string;
  dir: string;
  skillPath: string;
  size: number;
  mtimeMs: number;
}

/**
 * Brief summary of an existing skill, fed to the drafter so it can decide
 * whether to draft fresh, skip (because a similar skill already exists),
 * or — eventually — extend or reference one.
 */
export interface ExistingSkillSummary {
  id: string;
  description: string;
}

/**
 * Generate a SKILL.md draft for a candidate via a one-shot LLM call. Writes
 * to `<draftsRoot>/<slug>/SKILL.md` and returns the directory path on
 * success. The drafter is constrained to plain-text-only output with a
 * predictable frontmatter shape so we can validate before committing.
 *
 * If `existingSkills` is provided, they're injected into the prompt with
 * an instruction to respond `SKIP` when the candidate is sufficiently
 * similar to one that already exists — preventing the drafter from
 * producing near-duplicates of skills it (or the user) authored earlier.
 *
 * Returns `undefined` when the candidate has no example occurrences (we
 * have nothing to feed the drafter); throws when validation fails so the
 * caller can record an error.
 */
export async function draftCandidateSkill(
  candidate: SdSkillPattern,
  chat: SdBackgroundChat,
  draftsRoot: string,
  cfg: SdSkillBuilderConfig,
  existingSkills: readonly ExistingSkillSummary[] = [],
): Promise<string | undefined> {
  const examples = candidate.examples ?? [];
  if (examples.length === 0) return undefined;
  const messages: Message[] = [
    { role: 'system', content: SKILL_DRAFTER_SYSTEM_PROMPT },
    { role: 'user', content: buildDraftPrompt(candidate, examples, existingSkills) },
  ];
  const response = await chat(messages, { max_tokens: cfg.draft_max_tokens ?? 800 });
  const cleaned = stripFenceWrappers(response.content);
  if (!/^---\s*$/m.test(cleaned)) {
    throw new Error('drafted content has no frontmatter');
  }
  const slug = extractSlugFromFrontmatter(cleaned) ?? slugifyNgram(candidate.ngram);
  const draftDir = join(draftsRoot, slug);
  mkdirSync(draftDir, { recursive: true });
  const skillPath = join(draftDir, 'SKILL.md');
  const tmp = `${skillPath}.tmp`;
  writeFileSync(tmp, cleaned, 'utf8');
  renameSync(tmp, skillPath);
  return draftDir;
}

const SKILL_DRAFTER_SYSTEM_PROMPT = [
  'You author SKILL.md files for an AI agent. A SKILL.md captures a reusable',
  'workflow or domain procedure the agent has been observed to repeat.',
  '',
  'Output ONLY the SKILL.md content, with this exact shape:',
  '---',
  'name: <kebab-case-slug>',
  'description: <one-line summary, fewer than 120 chars, starts with a verb>',
  'tags: [tag1, tag2, tag3]',
  '---',
  '',
  '<one short paragraph: when to use this skill — what the user is asking',
  'for that should trigger the agent to consult this>',
  '',
  '<numbered steps describing the procedure, terse imperative voice>',
  '',
  'Do not include code fences. Do not include any explanation outside the',
  'SKILL.md. Keep the body under 250 words. If the recurring tool sequence',
  'is too generic to capture as a skill (e.g. just "read a file"), respond',
  'with the literal string "SKIP" and nothing else.',
].join('\n');

function buildDraftPrompt(
  candidate: SdSkillPattern,
  examples: CandidateExample[],
  existingSkills: readonly ExistingSkillSummary[],
): string {
  const lines = [
    `Recurring tool sequence: ${candidate.ngram.join(' → ')}`,
    `Observed ${candidate.totalCount} times across ${candidate.distinctSessions} distinct sessions.`,
    '',
    'Example occurrences:',
  ];
  examples.forEach((ex, i) => {
    lines.push(`${i + 1}. User asked: "${ex.precedingPrompt || '(no preceding prompt found)'}"`);
    for (const call of ex.calls) {
      lines.push(`   → ${call.name}(${call.args})`);
    }
  });
  if (existingSkills.length > 0) {
    lines.push(
      '',
      'Existing skills already in the catalog (do NOT draft a near-duplicate of any of these — respond SKIP instead):',
    );
    for (const skill of existingSkills) {
      lines.push(`  - ${skill.id}: ${skill.description}`);
    }
  }
  lines.push(
    '',
    'Draft a SKILL.md for this workflow if it captures real reusable knowledge that is NOT already covered by an existing skill above.',
    'Otherwise output exactly "SKIP".',
  );
  return lines.join('\n');
}

function stripFenceWrappers(value: string): string {
  return value
    .trim()
    .replace(/^```[a-zA-Z0-9]*\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
}

function extractSlugFromFrontmatter(content: string): string | undefined {
  const match = /^---\s*\n([\s\S]*?)\n---/m.exec(content);
  if (!match) return undefined;
  const nameLine = match[1]?.split('\n').find((line) => /^name\s*:/i.test(line));
  if (!nameLine) return undefined;
  const value = nameLine.split(':').slice(1).join(':').trim();
  return value || undefined;
}

function slugifyNgram(ngram: string[]): string {
  return ngram
    .map((name) => name.replace(/_/g, '-').toLowerCase())
    .join('-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Resolve the writable drafts directory for the active config+profile.
 * Returns undefined when no writable skill root is configured (e.g. a
 * read-only catalog).
 */
export function resolveDraftsDir(config: SdConfig, profile?: SdProfileInfo): string | undefined {
  const roots = resolveSdSkillRoots(config, profile);
  const writable = roots.find((root) => root.writable);
  if (!writable) return undefined;
  const dir = join(writable.root, DRAFTS_DIRNAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Like `resolveDraftsDir` but doesn't create the directory. */
export function peekDraftsDir(config: SdConfig, profile?: SdProfileInfo): string | undefined {
  const roots = resolveSdSkillRoots(config, profile);
  const writable = roots.find((root) => root.writable);
  if (!writable) return undefined;
  return join(writable.root, DRAFTS_DIRNAME);
}

export function listSkillDrafts(config: SdConfig, profile?: SdProfileInfo): SdSkillDraft[] {
  const dir = peekDraftsDir(config, profile);
  if (!dir || !existsSync(dir)) return [];
  const entries: SdSkillDraft[] = [];
  for (const name of safeReaddir(dir)) {
    if (name.startsWith('.')) continue;
    const sub = join(dir, name);
    const skillPath = join(sub, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const stat = safeStat(skillPath);
    if (!stat) continue;
    entries.push({ id: name, dir: sub, skillPath, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

export function readSkillDraft(
  config: SdConfig,
  profile: SdProfileInfo | undefined,
  id: string,
): { dir: string; content: string } | undefined {
  const drafts = listSkillDrafts(config, profile);
  const found = drafts.find((d) => d.id === id);
  if (!found) return undefined;
  try {
    return { dir: found.dir, content: readFileSync(found.skillPath, 'utf8') };
  } catch {
    return undefined;
  }
}

export function acceptSkillDraft(
  config: SdConfig,
  profile: SdProfileInfo | undefined,
  id: string,
): { dir: string } | { error: string } {
  const drafts = listSkillDrafts(config, profile);
  const found = drafts.find((d) => d.id === id);
  if (!found) return { error: `Draft not found: ${id}` };
  const draftsRoot = peekDraftsDir(config, profile);
  if (!draftsRoot) return { error: 'No writable skill root.' };
  const liveDir = join(dirname(draftsRoot), id);
  if (existsSync(liveDir)) return { error: `Skill already exists: ${liveDir}` };
  renameSync(found.dir, liveDir);
  return { dir: liveDir };
}

export function rejectSkillDraft(
  config: SdConfig,
  profile: SdProfileInfo | undefined,
  id: string,
): { ok: true } | { error: string } {
  const drafts = listSkillDrafts(config, profile);
  const found = drafts.find((d) => d.id === id);
  if (!found) return { error: `Draft not found: ${id}` };
  rmSync(found.dir, { recursive: true, force: true });
  return { ok: true };
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStat(path: string): { size: number; mtimeMs: number } | undefined {
  try {
    const s = statSync(path);
    return { size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return undefined;
  }
}
