import { buildExample } from './skill-builder-example.js';
import type { NgramEntry, NgramStats } from './skill-builder-ngram-types.js';
import type { SkillBuilderMessageRecord, SkillBuilderTraceEntry } from './skill-builder-types.js';

export function ingestSessionIntoStats(
  records: SkillBuilderMessageRecord[],
  sessionId: string,
  stats: NgramStats,
): void {
  ingestSessionDeltaIntoStats([], records, sessionId, stats);
}

export function ingestSessionDeltaIntoStats(
  previousTail: SkillBuilderMessageRecord[],
  newRecords: SkillBuilderMessageRecord[],
  sessionId: string,
  stats: NgramStats,
): void {
  const records = [...previousTail, ...newRecords];
  const trace = collectToolCallTrace(records);
  const sequence = trace.map((entry) => entry.call.name);
  for (const length of [2, 3] as const) {
    ingestNgrams(records, sessionId, stats, trace, sequence, length, previousTail.length);
  }
}

function ingestNgrams(
  records: SkillBuilderMessageRecord[],
  sessionId: string,
  stats: NgramStats,
  trace: SkillBuilderTraceEntry[],
  sequence: string[],
  length: 2 | 3,
  newRecordStart: number,
): void {
  for (let index = 0; index <= sequence.length - length; index += 1) {
    if ((trace[index + length - 1]?.recordIndex ?? -1) < newRecordStart) continue;
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
  if (
    entry.examples.length >= 3 ||
    entry.examples.some((example) => example.sessionId === sessionId)
  ) {
    return;
  }
  const example = buildExample(sessionId, records, trace, index, length);
  if (example) entry.examples.push(example);
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

function isInterestingNgram(ngram: string[]): boolean {
  const [first, second, third] = ngram;
  return ngram.length === 2 ? first !== second : first !== second || first !== third;
}
