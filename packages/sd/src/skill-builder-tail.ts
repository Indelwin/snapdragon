import type { SkillBuilderMessageRecord } from './skill-builder-types.js';

export function retainSkillBuilderTail(
  records: SkillBuilderMessageRecord[],
): SkillBuilderMessageRecord[] {
  const callRecordIndexes = records.flatMap((record, index) =>
    record.role === 'assistant' && record.tool_calls?.length ? [index] : [],
  );
  const firstRetainedCall = callRecordIndexes.at(-2);
  if (firstRetainedCall === undefined) {
    const latestUser = lastUserIndex(records);
    return latestUser < 0 ? [] : records.slice(latestUser);
  }
  const precedingUser = lastUserIndex(records, firstRetainedCall);
  return records.slice(precedingUser < 0 ? firstRetainedCall : precedingUser);
}

function lastUserIndex(records: SkillBuilderMessageRecord[], before = records.length): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    if (records[index]?.role === 'user') return index;
  }
  return -1;
}
