import { safeArgsPreview } from './skill-builder-args-preview.js';
import type {
  CandidateExample,
  SkillBuilderMessageRecord,
  SkillBuilderTraceEntry,
} from './skill-builder-types.js';

export function buildExample(
  sessionId: string,
  records: SkillBuilderMessageRecord[],
  trace: SkillBuilderTraceEntry[],
  ngramStart: number,
  n: number,
): CandidateExample | undefined {
  const slice = trace.slice(ngramStart, ngramStart + n);
  if (slice.length === 0) return undefined;
  return {
    sessionId,
    precedingPrompt: precedingPrompt(records, slice[0]?.recordIndex ?? 0),
    calls: slice.map(({ call }) => ({
      name: call.name,
      args: truncate(safeArgsPreview(call.args_json), 80),
    })),
  };
}

function precedingPrompt(
  records: SkillBuilderMessageRecord[],
  firstCallRecordIndex: number,
): string {
  for (let i = firstCallRecordIndex - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (record?.role === 'user') return truncate(record.content ?? '', 200);
  }
  return '';
}

function truncate(value: string, max: number): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}
