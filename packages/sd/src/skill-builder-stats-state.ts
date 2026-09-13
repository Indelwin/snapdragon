import { createNgramStats, type NgramEntry, type NgramStats } from './skill-builder-detect.js';
import type { CandidateExample, PersistedNgramEntry } from './skill-builder-types.js';

export function restoreNgramStats(entries: PersistedNgramEntry[] | undefined): NgramStats {
  const stats = createNgramStats();
  for (const candidate of entries ?? []) {
    const entry = restoredEntry(candidate);
    if (entry) stats.set(entry.ngram.join('→'), entry);
  }
  return stats;
}

export function snapshotNgramStats(stats: NgramStats): PersistedNgramEntry[] {
  return [...stats.values()].map((entry) => ({
    ngram: [...entry.ngram],
    count: entry.count,
    sessions: [...entry.sessions],
    examples: entry.examples.map(copyExample),
  }));
}

function restoredEntry(candidate: PersistedNgramEntry): NgramEntry | undefined {
  if (
    !Array.isArray(candidate.ngram) ||
    !candidate.ngram.every((name) => typeof name === 'string') ||
    !Number.isFinite(candidate.count) ||
    candidate.count < 0 ||
    !Array.isArray(candidate.sessions) ||
    !candidate.sessions.every((id) => typeof id === 'string') ||
    !Array.isArray(candidate.examples)
  ) {
    return undefined;
  }
  return {
    ngram: [...candidate.ngram],
    count: Math.floor(candidate.count),
    sessions: new Set(candidate.sessions),
    examples: candidate.examples.filter(isCandidateExample).slice(0, 3).map(copyExample),
  };
}

function isCandidateExample(value: CandidateExample): boolean {
  return (
    typeof value?.sessionId === 'string' &&
    typeof value.precedingPrompt === 'string' &&
    Array.isArray(value.calls)
  );
}

function copyExample(example: CandidateExample): CandidateExample {
  return {
    sessionId: example.sessionId,
    precedingPrompt: example.precedingPrompt,
    calls: example.calls.map((call) => ({ ...call })),
  };
}
