/**
 * Pattern detection for the skill-builder service. Pure functions that take
 * session JSONL records and return ranked candidate n-grams with rich
 * example context for the drafter.
 */

import type { SdSkillBuilderConfig } from './config.js';
import { buildExample } from './skill-builder-example.js';
import type {
  CandidateExample,
  SdSkillPattern,
  SkillBuilderMessageRecord,
  SkillBuilderTraceEntry,
} from './skill-builder-types.js';

export type {
  CandidateExample,
  SdSkillPattern,
  SkillBuilderMessageRecord,
} from './skill-builder-types.js';

interface NgramEntry {
  ngram: string[];
  count: number;
  sessions: Set<string>;
  examples: CandidateExample[];
}

/** Map keyed by ngram id ('a→b'); accumulates across sessions. */
export type NgramStats = Map<string, NgramEntry>;

/** Construct an empty stats map. */
export function createNgramStats(): NgramStats {
  return new Map();
}

/**
 * Walk one session's records, extract the tool-call sequence, and add
 * n-grams of length 2 and 3 to the running stats.
 */
export function ingestSessionIntoStats(
  records: SkillBuilderMessageRecord[],
  sessionId: string,
  stats: NgramStats,
): void {
  const trace = collectToolCallTrace(records);
  const sequence = trace.map((entry) => entry.call.name);
  for (const length of [2, 3] as const)
    ingestNgramsOfLength(records, sessionId, stats, trace, sequence, length);
}

function ingestNgramsOfLength(
  records: SkillBuilderMessageRecord[],
  sessionId: string,
  stats: NgramStats,
  trace: SkillBuilderTraceEntry[],
  sequence: string[],
  length: 2 | 3,
): void {
  if (sequence.length < length) return;
  for (let index = 0; index <= sequence.length - length; index += 1) {
    ingestNgramAt(records, sessionId, stats, trace, sequence, index, length);
  }
}

function ingestNgramAt(
  records: SkillBuilderMessageRecord[],
  sessionId: string,
  stats: NgramStats,
  trace: SkillBuilderTraceEntry[],
  sequence: string[],
  index: number,
  length: 2 | 3,
): void {
  const ngram = sequence.slice(index, index + length);
  if (!isInterestingNgram(ngram)) return;
  const entry = statsEntry(stats, ngram);
  entry.count += 1;
  entry.sessions.add(sessionId);
  appendCandidateExample(entry, sessionId, records, trace, index, length);
}

function statsEntry(stats: NgramStats, ngram: string[]): NgramEntry {
  const id = ngram.join('→');
  const entry = stats.get(id) ?? { ngram, count: 0, sessions: new Set<string>(), examples: [] };
  stats.set(id, entry);
  return entry;
}

function appendCandidateExample(
  entry: NgramEntry,
  sessionId: string,
  records: SkillBuilderMessageRecord[],
  trace: SkillBuilderTraceEntry[],
  index: number,
  length: 2 | 3,
): void {
  if (entry.examples.length >= 3 || entry.examples.some((e) => e.sessionId === sessionId)) return;
  const example = buildExample(sessionId, records, trace, index, length);
  if (example) entry.examples.push(example);
}

/**
 * Default leading-tool denylist. These are agent-side context-gathering
 * primitives: every session starts with one of them as part of
 * orientation, so n-grams that begin with them aren't real user
 * workflows. Override via `skills.builder.exclude_leading_tools`.
 */
export const DEFAULT_EXCLUDE_LEADING_TOOLS: readonly string[] = [
  'memory_search',
  'memory_manage',
  'skills_list',
  'skills_search',
  'skill_load',
  'skill_manage',
];

/**
 * Reduce stats into ranked candidates, applying:
 *   1. count + distinct-session thresholds,
 *   2. leading-tool denylist (drops 'memory_search → ...' etc.),
 *   3. subsumed-n-gram collapse (when both 'a→b' and 'a→b→c' pass, keep
 *      only the longer one — it's the more specific view of the same
 *      pattern).
 *
 * Sorted most-frequent first; ties by longer (= more specific) n-gram.
 */
export function rankCandidates(stats: NgramStats, cfg: SdSkillBuilderConfig): SdSkillPattern[] {
  const minCount = cfg.min_pattern_count ?? 3;
  const minDistinct = cfg.min_distinct_sessions ?? 2;
  const denylist = new Set(cfg.exclude_leading_tools ?? DEFAULT_EXCLUDE_LEADING_TOOLS);
  const collapseSubsumed = cfg.collapse_subsumed !== false;

  const passing = [...stats.entries()]
    .filter(([, entry]) => entry.count >= minCount && entry.sessions.size >= minDistinct)
    .filter(([, entry]) => !denylist.has(entry.ngram[0] ?? ''))
    .map(([id, entry]) => ({
      id,
      ngram: entry.ngram,
      totalCount: entry.count,
      distinctSessions: entry.sessions.size,
      exampleSessions: [...entry.sessions].slice(0, 3),
      examples: entry.examples,
    }));

  const survivors = collapseSubsumed ? collapseSubsumedNgrams(passing) : passing;
  return survivors.sort((a, b) => b.totalCount - a.totalCount || b.ngram.length - a.ngram.length);
}

/**
 * Suppress any candidate whose n-gram is a contiguous substring of a
 * strictly-longer surviving candidate's n-gram. The longer match is more
 * specific and captures the same workflow — emitting both adds noise
 * without info.
 *
 * E.g. with surviving `alpha→beta→gamma` (3-gram), the 2-grams
 * `alpha→beta` (prefix) AND `beta→gamma` (suffix) BOTH get dropped. If
 * ONLY a 2-gram passes (its 3-gram extensions too diffuse to clear
 * threshold), it survives because nothing subsumes it.
 */
function collapseSubsumedNgrams(candidates: SdSkillPattern[]): SdSkillPattern[] {
  return candidates.filter((c) => {
    for (const other of candidates) {
      if (other === c) continue;
      if (other.ngram.length <= c.ngram.length) continue;
      if (containsSlice(other.ngram, c.ngram)) return false;
    }
    return true;
  });
}

/** True iff `needle` appears as a contiguous slice inside `haystack`. */
function containsSlice(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function collectToolCallTrace(records: SkillBuilderMessageRecord[]): SkillBuilderTraceEntry[] {
  const out: SkillBuilderTraceEntry[] = [];
  records.forEach((record, recordIndex) => {
    if (record.role !== 'assistant') return;
    for (const call of record.tool_calls ?? []) {
      if (call?.name) out.push({ call, recordIndex });
    }
  });
  return out;
}

/**
 * Reject "interesting"-but-actually-noise n-grams: a pair of identical
 * tool names is just "I called X twice" (e.g. read multiple files).
 * We require at least two distinct tools so the n-gram captures a transition.
 */
function isInterestingNgram(ngram: string[]): boolean {
  return new Set(ngram).size >= 2;
}
