/**
 * Pattern detection for the skill-builder service. Pure functions that take
 * session JSONL records and return ranked candidate n-grams with rich
 * example context for the drafter.
 */

import type { SessionMessageRecord } from '@snapdragon-ai/session';
import type { SdSkillBuilderConfig } from './config.js';

/**
 * Detected pattern: an n-gram of tool names with the sessions/runs it
 * appeared in.
 */
export interface SdSkillPattern {
  /** Stable id derived from the n-gram (e.g. 'read_file→write_file'). */
  id: string;
  ngram: string[];
  totalCount: number;
  distinctSessions: number;
  exampleSessions: string[];
  /** Up to 3 example occurrences with surrounding user-prompt context. */
  examples?: CandidateExample[];
}

/**
 * One example occurrence of a candidate n-gram, captured at detection time
 * so the drafter doesn't have to re-read the JSONL.
 */
export interface CandidateExample {
  sessionId: string;
  /** Most-recent user prompt text before the n-gram (truncated). */
  precedingPrompt: string;
  /** Tool calls in n-gram order with truncated args. */
  calls: Array<{ name: string; args: string }>;
}

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
  records: SessionMessageRecord[],
  sessionId: string,
  stats: NgramStats,
): void {
  const trace = collectToolCallTrace(records);
  const sequence = trace.map((entry) => entry.call.name);
  for (const n of [2, 3] as const) {
    if (sequence.length < n) continue;
    for (let i = 0; i <= sequence.length - n; i += 1) {
      const ngram = sequence.slice(i, i + n);
      if (!isInterestingNgram(ngram)) continue;
      const id = ngram.join('→');
      const entry = stats.get(id) ?? { ngram, count: 0, sessions: new Set<string>(), examples: [] };
      entry.count += 1;
      entry.sessions.add(sessionId);
      if (entry.examples.length < 3 && !entry.examples.some((e) => e.sessionId === sessionId)) {
        const example = buildExample(sessionId, records, trace, i, n);
        if (example) entry.examples.push(example);
      }
      stats.set(id, entry);
    }
  }
}

/**
 * Reduce stats into ranked candidates, applying the configured count and
 * distinct-sessions thresholds. Sorted most-frequent first; ties by
 * longer (= more specific) n-gram.
 */
export function rankCandidates(stats: NgramStats, cfg: SdSkillBuilderConfig): SdSkillPattern[] {
  const minCount = cfg.min_pattern_count ?? 3;
  const minDistinct = cfg.min_distinct_sessions ?? 2;
  return [...stats.entries()]
    .filter(([, entry]) => entry.count >= minCount && entry.sessions.size >= minDistinct)
    .map(([id, entry]) => ({
      id,
      ngram: entry.ngram,
      totalCount: entry.count,
      distinctSessions: entry.sessions.size,
      exampleSessions: [...entry.sessions].slice(0, 3),
      examples: entry.examples,
    }))
    .sort((a, b) => b.totalCount - a.totalCount || b.ngram.length - a.ngram.length);
}

interface TraceEntry {
  call: { name: string; args_json?: string };
  recordIndex: number;
}

function collectToolCallTrace(records: SessionMessageRecord[]): TraceEntry[] {
  const out: TraceEntry[] = [];
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

function buildExample(
  sessionId: string,
  records: SessionMessageRecord[],
  trace: TraceEntry[],
  ngramStart: number,
  n: number,
): CandidateExample | undefined {
  const slice = trace.slice(ngramStart, ngramStart + n);
  if (slice.length === 0) return undefined;
  const firstCallRecordIndex = slice[0]?.recordIndex ?? 0;
  let precedingPrompt = '';
  for (let i = firstCallRecordIndex - 1; i >= 0; i -= 1) {
    const r = records[i];
    if (r?.role === 'user') {
      precedingPrompt = textFromContent(r.content);
      break;
    }
  }
  return {
    sessionId,
    precedingPrompt: truncate(precedingPrompt, 200),
    calls: slice.map(({ call }) => ({
      name: call.name,
      args: truncate(safeArgsPreview(call.args_json), 80),
    })),
  };
}

function textFromContent(content: SessionMessageRecord['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is { type: 'text'; text: string } => b?.type === 'text')
    .map((b) => b.text)
    .join(' ')
    .trim();
}

function safeArgsPreview(argsJson: string | undefined): string {
  if (!argsJson) return '';
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ');
  } catch {
    return argsJson;
  }
}

function truncate(value: string, max: number): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}
