import type { ExpectedToolCall } from './dataset.js';
import type { ToolTraceStep } from './rollout.js';
import { stableStringify } from './stable-stringify.js';

export function expectedToolCallMatches(expected: ExpectedToolCall, call: ToolTraceStep): boolean {
  if (call.name !== expected.name) return false;
  if (expected.inputContains && !objectContains(call.input, expected.inputContains)) return false;
  return expected.outputContains === undefined || outputContains(call, expected.outputContains);
}

function outputContains(call: ToolTraceStep, expected: string | string[]): boolean {
  const output = call.output === undefined || call.output === null ? '' : String(call.output);
  const fragments = Array.isArray(expected) ? expected : [expected];
  return fragments.every((fragment) => output.includes(fragment));
}

function objectContains(value: unknown, expected: Record<string, unknown>): boolean {
  if (!value || typeof value !== 'object') return false;
  const actual = value as Record<string, unknown>;
  return Object.entries(expected).every(
    ([key, expectedValue]) => stableStringify(actual[key]) === stableStringify(expectedValue),
  );
}
