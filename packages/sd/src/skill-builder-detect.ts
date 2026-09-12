/**
 * Pattern detection for the skill-builder service. Pure functions that take
 * session JSONL records and return ranked candidate n-grams with rich
 * example context for the drafter.
 */

import type { SdSkillBuilderConfig } from './config.js';
import type { NgramStats } from './skill-builder-ngram-types.js';
import type { SdSkillPattern } from './skill-builder-types.js';

export {
  ingestSessionDeltaIntoStats,
  ingestSessionIntoStats,
} from './skill-builder-ngram-ingest.js';
export type { NgramEntry, NgramStats } from './skill-builder-ngram-types.js';
export type {
  CandidateExample,
  SdSkillPattern,
  SkillBuilderMessageRecord,
} from './skill-builder-types.js';

/** Construct an empty stats map. */
export function createNgramStats(): NgramStats {
  return new Map();
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
