/** Auto skill builder: detect repeated tool-call workflows and surface draftable skills. */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  SdBackgroundChat,
  SdBackgroundContext,
  SdBackgroundService,
  SdBackgroundServiceResult,
} from './background.js';
import type { SdConfig, SdSkillBuilderConfig } from './config.js';
import type { SdMemoryProvider } from './memory.js';
import type { SdProfileInfo } from './profile.js';
import { rankCandidates } from './skill-builder-detect.js';
import {
  draftCandidateSkill,
  type ExistingSkillSummary,
  resolveDraftsDir,
} from './skill-builder-draft.js';
import { scanSessionsForNgrams } from './skill-builder-session-scan.js';
import { buildSkillSimilarityQuery } from './skill-builder-similarity.js';
import type {
  BuilderState,
  SdSkillBuilderScanResult,
  SdSkillPattern,
} from './skill-builder-types.js';

export {
  acceptSkillDraft,
  type ExistingSkillSummary,
  listSkillDrafts,
  readSkillDraft,
  rejectSkillDraft,
  type SdSkillDraft,
} from './skill-builder-draft.js';
export { buildSkillSimilarityQuery } from './skill-builder-similarity.js';
export type {
  BuilderState,
  CandidateExample,
  SdSkillBuilderScanResult,
  SdSkillPattern,
} from './skill-builder-types.js';

export interface SdSkillBuilderOptions {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  /** When provided, the builder will use it to draft SKILL.md content from candidates. */
  chat?: SdBackgroundChat;
  /**
   * Static "existing skills" list — fed verbatim to the drafter for every
   * candidate. Useful in tests where you want a fixed similarity slate.
   * In production, prefer `findSimilarSkills` so the drafter only sees
   * skills that plausibly overlap with each specific candidate.
   */
  existingSkills?: ReadonlyArray<ExistingSkillSummary>;
  /**
   * Per-candidate top-K similarity lookup. The orchestrator calls this
   * just before drafting and forwards the result to the drafter so it
   * can SKIP near-duplicates. When both this and `existingSkills` are
   * set, `findSimilarSkills` wins.
   */
  findSimilarSkills?: (candidate: SdSkillPattern) => readonly ExistingSkillSummary[];
  log?: (line: string) => void;
}

const STATE_FILENAME = '.worker-state.json';

/** One pass of the skill-builder. Pure with respect to wall-clock. */
export async function runSdSkillBuilderOnce(
  options: SdSkillBuilderOptions,
): Promise<SdSkillBuilderScanResult> {
  const result: SdSkillBuilderScanResult = {
    scanned_sessions: 0,
    patterns_found: 0,
    candidates_emitted: 0,
    drafts_written: 0,
    errors: [],
  };
  const cfg = builderConfig(options.config);
  if (cfg.enabled === false) return result;

  const stateDir = resolveDraftsDir(options.config, options.profile);
  if (!stateDir) return result;
  const statePath = join(stateDir, STATE_FILENAME);
  const state = readState(statePath);

  const stats = await scanSessionsForNgrams(options.config, state, result, cfg);
  const candidates = rankCandidates(stats, cfg);
  result.patterns_found = candidates.length;

  await processCandidates(candidates, state, options, stateDir, cfg, result);

  writeState(statePath, state);
  return result;
}

/**
 * For each candidate above thresholds: optionally draft a SKILL.md (when
 * `ctx.chat` is available and we're under the per-pass cap), then emit a
 * memory note pointing at the draft (or just the candidate itself).
 */
async function processCandidates(
  candidates: SdSkillPattern[],
  state: BuilderState,
  options: SdSkillBuilderOptions,
  stateDir: string,
  cfg: SdSkillBuilderConfig,
  result: SdSkillBuilderScanResult,
): Promise<void> {
  let draftsWritten = 0;
  const maxDrafts = cfg.max_drafts_per_pass ?? 1;
  const drafted = new Set(state.drafted ?? []);

  for (const candidate of candidates) {
    const hash = candidateHash(candidate);
    const alreadyEmitted = state.emitted.includes(hash);
    const alreadyDrafted = drafted.has(hash);

    let draftPath: string | undefined;
    if (
      !alreadyDrafted &&
      draftsWritten < maxDrafts &&
      options.chat &&
      candidate.totalCount >= (cfg.min_pattern_count_for_draft ?? cfg.min_pattern_count ?? 3)
    ) {
      try {
        const similar = options.findSimilarSkills
          ? options.findSimilarSkills(candidate)
          : (options.existingSkills ?? []);
        draftPath = await draftCandidateSkill(candidate, options.chat, stateDir, cfg, similar);
        if (draftPath) {
          drafted.add(hash);
          draftsWritten += 1;
          result.drafts_written += 1;
          options.log?.(`[skill-builder] drafted skill: ${draftPath}`);
        }
      } catch (error) {
        result.errors.push(
          `draft failed for ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (alreadyEmitted && !draftPath) continue;
    try {
      await emitCandidateMemory(candidate, options.memory, draftPath);
      if (!alreadyEmitted) {
        state.emitted.push(hash);
        result.candidates_emitted += 1;
        options.log?.(`[skill-builder] surfaced candidate: ${candidate.id}`);
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  state.drafted = [...drafted];
}

/**
 * Wrap the skill builder as an `SdBackgroundService` so it slots into the
 * generic gateway alongside memory-worker. Enabled by default; opt out
 * via `skills.builder.enabled = false`.
 */
export function skillBuilderService(): SdBackgroundService {
  return {
    name: 'skill-builder',
    enabled(ctx: SdBackgroundContext) {
      const cfg = builderConfig(ctx.config);
      if (cfg.enabled === false) return false;
      if (ctx.config.memory?.enabled === false) return false;
      if (ctx.config.memory?.authoring === false) return false;
      return true;
    },
    intervalMs(ctx: SdBackgroundContext) {
      return builderConfig(ctx.config).interval_ms ?? 30 * 60 * 1000;
    },
    startupDelayMs(ctx: SdBackgroundContext) {
      const cfg = builderConfig(ctx.config);
      return cfg.startup_delay_ms ?? cfg.interval_ms ?? 30 * 60 * 1000;
    },
    async runOnce(ctx: SdBackgroundContext): Promise<SdBackgroundServiceResult> {
      // Surface only top-K skills similar to each candidate (routed through
      // the FTS skill index when one is attached; falls back to the
      // substring scorer otherwise). Replaces the older "dump the whole
      // catalog at the drafter" behaviour, which was linear in catalog size.
      const findSimilarSkills = makeFindSimilarSkills(ctx, builderConfig(ctx.config));
      const result = await runSdSkillBuilderOnce({
        config: ctx.config,
        memory: ctx.memory,
        profile: ctx.profile,
        chat: ctx.chat,
        findSimilarSkills,
        log: ctx.log,
      });
      return {
        summary: summarizeResult(result),
        metrics: {
          scanned_sessions: result.scanned_sessions,
          patterns_found: result.patterns_found,
          candidates_emitted: result.candidates_emitted,
          drafts_written: result.drafts_written,
          errors: result.errors.length,
        },
      };
    },
  };
}

/**
 * Build a `findSimilarSkills` closure for the service runtime. Returns
 * `undefined` when no skill store is wired (some tests / minimal
 * runtimes), in which case the drafter sees no similarity context.
 */
function makeFindSimilarSkills(
  ctx: SdBackgroundContext,
  cfg: SdSkillBuilderConfig,
): ((candidate: SdSkillPattern) => readonly ExistingSkillSummary[]) | undefined {
  const skills = ctx.skills;
  if (!skills) return undefined;
  const topK = cfg.similarity_top_k ?? 30;
  return (candidate) => {
    const query = buildSkillSimilarityQuery(candidate);
    if (query.length === 0) return [];
    try {
      return skills.search(query, topK).map((skill) => ({
        id: skill.id,
        description: skill.description ?? '',
      }));
    } catch (error) {
      ctx.log?.(
        `[skill-builder] similarity lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  };
}

function summarizeResult(result: SdSkillBuilderScanResult): string {
  if (result.drafts_written > 0) {
    return `drafted ${result.drafts_written} skill(s); surfaced ${result.candidates_emitted} candidate(s)`;
  }
  if (result.candidates_emitted > 0) {
    return `surfaced ${result.candidates_emitted} candidate(s) across ${result.scanned_sessions} session(s)`;
  }
  return `scanned ${result.scanned_sessions}, ${result.patterns_found} pattern(s) (${result.candidates_emitted} new)`;
}

async function emitCandidateMemory(
  candidate: SdSkillPattern,
  memory: SdMemoryProvider,
  draftPath?: string,
): Promise<void> {
  const content = formatCandidateContent(candidate, draftPath);
  const tags = draftPath
    ? ['auto', 'skill-draft-ready', 'worker']
    : ['auto', 'tentative', 'skill-candidate', 'worker'];
  const result = await Promise.resolve(
    memory.append({
      title: draftPath ? `Skill draft ready: ${candidate.id}` : `Skill candidate: ${candidate.id}`,
      content,
      tags,
      source: 'sd.skill-builder',
    }),
  );
  if (!result.success) throw new Error(result.error ?? 'append failed');
}

function formatCandidateContent(candidate: SdSkillPattern, draftPath?: string): string {
  const lines = [
    `Recurring tool sequence detected: ${candidate.ngram.join(' → ')}`,
    `Seen ${candidate.totalCount}× across ${candidate.distinctSessions} distinct session(s).`,
    `Example sessions: ${candidate.exampleSessions.join(', ')}.`,
  ];
  if (draftPath) {
    lines.push(
      '',
      `A SKILL.md draft has been written to ${draftPath}.`,
      'Use /skills accept <id> to promote it into the active catalog,',
      '/skills draft <id> to view, or /skills reject <id> to delete.',
    );
  } else {
    lines.push(
      '',
      'If this represents a real workflow, consider authoring a skill for it',
      'or use /memory promote to keep this note. /memory forget removes it.',
    );
  }
  return lines.join('\n');
}

function candidateHash(candidate: SdSkillPattern): string {
  let hash = 0x811c9dc5;
  for (const ch of candidate.id) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function builderConfig(config: SdConfig): SdSkillBuilderConfig {
  return config.skills?.builder ?? {};
}

function readState(path: string): BuilderState {
  if (!existsSync(path)) return { version: 1, sessions: {}, emitted: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BuilderState;
    if (parsed?.version === 1 && parsed.sessions && Array.isArray(parsed.emitted)) {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  return { version: 1, sessions: {}, emitted: [] };
}

function writeState(path: string, state: BuilderState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, undefined, 2), 'utf8');
  renameSync(tmp, path);
}
