/**
 * Auto skill builder.
 *
 * Goal (manifesto: "If an agent does it more than twice, automate it"):
 * detect repeated tool-call workflows across recent sessions and surface
 * them as candidates the agent (and user) can decide whether to promote
 * to a real skill.
 *
 * Phase-1 scope (this file):
 *   - Sweep the last N session JSONLs.
 *   - Extract ordered tool_call name sequences from assistant turns.
 *   - Compute n-grams (length 2 and 3) and count occurrences across
 *     distinct sessions.
 *   - For each candidate above the threshold (count and distinct-session
 *     count), append a `tentative` + `skill-candidate` memory entry —
 *     so it flows through the existing memory-injection path the agent
 *     already reads on every turn. No LLM call, no separate UI surface.
 *   - Persist watermarks + candidate hashes in the skill root's
 *     `.drafts/.worker-state.json` so reruns are idempotent.
 *
 * Phase-2 (deferred): take the candidates, draft a SKILL.md via an LLM
 * call, write to `<skill_root>/.drafts/<id>/SKILL.md`, and add /skills
 * accept|reject commands. The detection in this file is the input
 * signal that step needs.
 *
 * Enabled by default — the user explicitly asked for this to be
 * dogfooded the same way the memory worker is.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readRecords, type SessionMessageRecord } from '@snapdragon-ai/session';
import type {
  SdBackgroundContext,
  SdBackgroundService,
  SdBackgroundServiceResult,
} from './background.js';
import type { SdConfig, SdSkillBuilderConfig } from './config.js';
import type { SdMemoryProvider } from './memory.js';
import type { SdProfileInfo } from './profile.js';
import { runtimeSessionStore } from './runtime-session.js';
import { resolveSdSkillRoots } from './skills.js';

interface BuilderState {
  version: 1;
  /** Per-session high-watermark message timestamp processed. */
  sessions: Record<string, { last_processed_at: number }>;
  /** Hashes of candidates already surfaced — never re-emit the same one. */
  emitted: string[];
}

export interface SdSkillBuilderScanResult {
  scanned_sessions: number;
  patterns_found: number;
  candidates_emitted: number;
  errors: string[];
}

export interface SdSkillBuilderOptions {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  log?: (line: string) => void;
}

const STATE_FILENAME = '.worker-state.json';
const DRAFTS_DIRNAME = '.drafts';

/**
 * Detected pattern: an n-gram of tool names with the sessions/runs it
 * appeared in. Exposed for tests.
 */
export interface SdSkillPattern {
  /** Stable id derived from the n-gram (e.g. 'read_file→write_file'). */
  id: string;
  ngram: string[];
  totalCount: number;
  distinctSessions: number;
  exampleSessions: string[];
}

/** One pass of the skill-builder. Pure with respect to wall-clock. */
export async function runSdSkillBuilderOnce(
  options: SdSkillBuilderOptions,
): Promise<SdSkillBuilderScanResult> {
  const result: SdSkillBuilderScanResult = {
    scanned_sessions: 0,
    patterns_found: 0,
    candidates_emitted: 0,
    errors: [],
  };
  const cfg = builderConfig(options.config);
  if (cfg.enabled === false) return result;

  const stateDir = resolveDraftsDir(options.config, options.profile);
  if (!stateDir) return result;
  const statePath = join(stateDir, STATE_FILENAME);
  const state = readState(statePath);

  const lookback = cfg.lookback_sessions ?? 10;
  const sessions = runtimeSessionStore(options.config).list().slice(0, lookback);

  // toolNgram → { count, sessions: Set<string> }
  const ngramStats = new Map<string, { ngram: string[]; count: number; sessions: Set<string> }>();

  for (const session of sessions) {
    result.scanned_sessions += 1;
    const watermark = state.sessions[session.session_id]?.last_processed_at ?? 0;
    let highest = watermark;
    let records: SessionMessageRecord[] = [];
    try {
      records = readRecords(session.jsonl_path).filter(
        (record): record is SessionMessageRecord => record.type === 'message',
      );
    } catch (error) {
      result.errors.push(
        `Failed to read ${session.jsonl_path}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const newRecords = records.filter((record) => record.created_at > watermark);
    for (const record of newRecords) {
      if (record.created_at > highest) highest = record.created_at;
    }
    if (newRecords.length === 0) continue;

    // Tool names in chronological order from THIS session's assistant turns.
    // We use the FULL session (not just newRecords) so patterns aren't broken
    // across watermark boundaries — the watermark tracks "have we processed
    // this session's tail yet" not "which prefix to look at".
    const toolSequence = collectToolSequence(records);
    addNgramsToStats(toolSequence, session.session_id, ngramStats);

    if (highest > watermark) {
      state.sessions[session.session_id] = { last_processed_at: highest };
    }
  }

  const candidates = filterCandidates(ngramStats, cfg);
  result.patterns_found = candidates.length;

  for (const candidate of candidates) {
    const hash = candidateHash(candidate);
    if (state.emitted.includes(hash)) continue;
    try {
      await emitCandidateMemory(candidate, options.memory);
      state.emitted.push(hash);
      result.candidates_emitted += 1;
      options.log?.(`[skill-builder] surfaced candidate: ${candidate.id}`);
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  writeState(statePath, state);
  return result;
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
      // Default-on dogfooding posture: only disabled when the user
      // explicitly says so. Memory still has to be usable for capture.
      const cfg = builderConfig(ctx.config);
      if (cfg.enabled === false) return false;
      if (ctx.config.memory?.enabled === false) return false;
      if (ctx.config.memory?.authoring === false) return false;
      return true;
    },
    intervalMs(ctx: SdBackgroundContext) {
      return builderConfig(ctx.config).interval_ms ?? 30 * 60 * 1000;
    },
    async runOnce(ctx: SdBackgroundContext): Promise<SdBackgroundServiceResult> {
      const result = await runSdSkillBuilderOnce({
        config: ctx.config,
        memory: ctx.memory,
        profile: ctx.profile,
        log: ctx.log,
      });
      return {
        summary:
          result.candidates_emitted > 0
            ? `surfaced ${result.candidates_emitted} candidate(s) across ${result.scanned_sessions} session(s)`
            : `scanned ${result.scanned_sessions}, ${result.patterns_found} pattern(s) (${result.candidates_emitted} new)`,
        metrics: {
          scanned_sessions: result.scanned_sessions,
          patterns_found: result.patterns_found,
          candidates_emitted: result.candidates_emitted,
          errors: result.errors.length,
        },
      };
    },
  };
}

/**
 * Pull the ordered list of tool names from assistant turns in a session.
 * Multiple tools in a single assistant turn are emitted in their declared
 * order; tool_results don't contribute (they don't represent decisions).
 */
function collectToolSequence(records: SessionMessageRecord[]): string[] {
  const out: string[] = [];
  for (const record of records) {
    if (record.role !== 'assistant') continue;
    const calls = record.tool_calls;
    if (!calls) continue;
    for (const call of calls) if (call?.name) out.push(call.name);
  }
  return out;
}

function addNgramsToStats(
  sequence: string[],
  sessionId: string,
  stats: Map<string, { ngram: string[]; count: number; sessions: Set<string> }>,
): void {
  // n=2 and n=3 — long enough to be a recognizable workflow, short enough
  // that legitimate variations of a workflow share the same n-gram.
  for (const n of [2, 3] as const) {
    if (sequence.length < n) continue;
    for (let i = 0; i <= sequence.length - n; i += 1) {
      const ngram = sequence.slice(i, i + n);
      if (!isInterestingNgram(ngram)) continue;
      const id = ngram.join('→');
      const entry = stats.get(id) ?? { ngram, count: 0, sessions: new Set<string>() };
      entry.count += 1;
      entry.sessions.add(sessionId);
      stats.set(id, entry);
    }
  }
}

/**
 * Reject "interesting"-but-actually-noise n-grams: a pair of identical
 * tool names is just "I called X twice" (e.g. read multiple files).
 * Trigrams of three-of-a-kind are similarly uninteresting. We require at
 * least two distinct tools so the n-gram captures a transition.
 */
function isInterestingNgram(ngram: string[]): boolean {
  return new Set(ngram).size >= 2;
}

function filterCandidates(
  stats: Map<string, { ngram: string[]; count: number; sessions: Set<string> }>,
  cfg: SdSkillBuilderConfig,
): SdSkillPattern[] {
  const minCount = cfg.min_pattern_count ?? 3;
  const minDistinct = cfg.min_distinct_sessions ?? 2;
  return (
    [...stats.entries()]
      .filter(([, entry]) => entry.count >= minCount && entry.sessions.size >= minDistinct)
      .map(([id, entry]) => ({
        id,
        ngram: entry.ngram,
        totalCount: entry.count,
        distinctSessions: entry.sessions.size,
        exampleSessions: [...entry.sessions].slice(0, 3),
      }))
      // Most frequent first; ties broken by longer n-gram (more specific).
      .sort((a, b) => b.totalCount - a.totalCount || b.ngram.length - a.ngram.length)
  );
}

async function emitCandidateMemory(
  candidate: SdSkillPattern,
  memory: SdMemoryProvider,
): Promise<void> {
  const content = formatCandidateContent(candidate);
  const result = await Promise.resolve(
    memory.append({
      title: `Skill candidate: ${candidate.id}`,
      content,
      tags: ['auto', 'tentative', 'skill-candidate', 'worker'],
      source: 'sd.skill-builder',
    }),
  );
  if (!result.success) throw new Error(result.error ?? 'append failed');
}

function formatCandidateContent(candidate: SdSkillPattern): string {
  return [
    `Recurring tool sequence detected: ${candidate.ngram.join(' → ')}`,
    `Seen ${candidate.totalCount}× across ${candidate.distinctSessions} distinct session(s).`,
    `Example sessions: ${candidate.exampleSessions.join(', ')}.`,
    '',
    'If this represents a real workflow, consider authoring a skill for it',
    'or use /memory promote to keep this note. /memory forget removes it.',
  ].join('\n');
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

function resolveDraftsDir(config: SdConfig, profile?: SdProfileInfo): string | undefined {
  // Use the FIRST writable skill root as the drafts location. The walk
  // logic in skills.ts already excludes `.`-prefixed directories, so
  // `.drafts/` is invisible to skill discovery.
  const roots = resolveSdSkillRoots(config, profile);
  const writable = roots.find((root) => root.writable);
  if (!writable) return undefined;
  const dir = join(writable.root, DRAFTS_DIRNAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readState(path: string): BuilderState {
  if (!existsSync(path)) return { version: 1, sessions: {}, emitted: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BuilderState;
    if (parsed?.version === 1 && parsed.sessions && Array.isArray(parsed.emitted)) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { version: 1, sessions: {}, emitted: [] };
}

function writeState(path: string, state: BuilderState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, undefined, 2), 'utf8');
  renameSync(tmp, path);
}
