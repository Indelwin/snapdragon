import { consecutiveDuplicateToolIndexes, repeatedFailedToolCalls } from './tool-trace-analysis.js';
import { issue, verifierResult } from './verifier-result.js';
import type { Verifier } from './verifier-types.js';

export function toolSuccessVerifier(
  options: { id?: string; minimumSuccessRate?: number } = {},
): Verifier {
  const id = options.id ?? 'tool-success';
  const minimumSuccessRate = options.minimumSuccessRate ?? 1;
  return {
    id,
    verify(_example, rollout) {
      const score = rollout.toolCalls.length
        ? rollout.toolCalls.filter((call) => call.success).length / rollout.toolCalls.length
        : 1;
      const passed = score >= minimumSuccessRate;
      return verifierResult(
        id,
        passed,
        passed
          ? []
          : [
              issue(
                'tool-failure',
                'error',
                `tool success rate ${score} below ${minimumSuccessRate}`,
              ),
            ],
        score,
      );
    },
  };
}

export function maxToolCallsVerifier(
  options: { id?: string; maxToolCalls?: number } = {},
): Verifier {
  const id = options.id ?? 'max-tool-calls';
  return {
    id,
    verify(example, rollout) {
      const maxToolCalls = options.maxToolCalls ?? example.maxToolCalls;
      if (maxToolCalls === undefined) return verifierResult(id, true, [], 1);
      const passed = rollout.toolCalls.length <= maxToolCalls;
      return verifierResult(
        id,
        passed,
        maxToolCallIssues(passed, rollout.toolCalls.length, maxToolCalls),
        maxToolCallScore(passed, rollout.toolCalls.length, maxToolCalls),
      );
    },
  };
}

export function noConsecutiveDuplicateToolsVerifier(options: { id?: string } = {}): Verifier {
  const id = options.id ?? 'no-consecutive-duplicate-tools';
  return {
    id,
    verify(_example, rollout) {
      const duplicateIndexes = consecutiveDuplicateToolIndexes(rollout);
      return verifierResult(
        id,
        duplicateIndexes.length === 0,
        duplicateIndexes.map((index) =>
          issue(
            'consecutive-duplicate-tool',
            'warning',
            `tool call ${index} repeats the previous call`,
            { index },
          ),
        ),
        duplicateIndexes.length === 0
          ? 1
          : Math.max(0, 1 - duplicateIndexes.length / rollout.toolCalls.length),
      );
    },
  };
}

export function noRepeatedFailedToolCallsVerifier(options: { id?: string } = {}): Verifier {
  const id = options.id ?? 'no-repeated-failed-tool-calls';
  return {
    id,
    verify(_example, rollout) {
      const repeats = repeatedFailedToolCalls(rollout);
      return verifierResult(
        id,
        repeats.length === 0,
        repeats.map((call) =>
          issue('repeated-failed-tool-call', 'warning', `repeated failed tool call ${call.name}`, {
            call,
          }),
        ),
        repeats.length === 0
          ? 1
          : Math.max(0, 1 - repeats.length / Math.max(1, rollout.toolCalls.length)),
      );
    },
  };
}

export function nonEmptyToolOutputVerifier(
  options: { id?: string; tools?: string[] } = {},
): Verifier {
  const id = options.id ?? 'non-empty-tool-output';
  return {
    id,
    verify(_example, rollout) {
      const allowed = options.tools ? new Set(options.tools) : undefined;
      const empty = rollout.toolCalls.filter((call) => emptySuccessfulToolOutput(call, allowed));
      return verifierResult(
        id,
        empty.length === 0,
        empty.map((call) =>
          issue('empty-tool-output', 'warning', `tool ${call.name} returned empty output`, {
            call,
          }),
        ),
        empty.length === 0
          ? 1
          : Math.max(0, 1 - empty.length / Math.max(1, rollout.toolCalls.length)),
      );
    },
  };
}

function maxToolCallIssues(passed: boolean, used: number, maxToolCalls: number) {
  return passed
    ? []
    : [issue('too-many-tool-calls', 'warning', `used ${used} tool calls; max is ${maxToolCalls}`)];
}

function maxToolCallScore(passed: boolean, used: number, maxToolCalls: number): number {
  return passed ? 1 : Math.max(0, maxToolCalls / Math.max(1, used));
}

function emptySuccessfulToolOutput(
  call: { name: string; success: boolean; output?: unknown },
  allowed?: Set<string>,
): boolean {
  return (
    (!allowed || allowed.has(call.name)) &&
    call.success &&
    (call.output === undefined || call.output === null || String(call.output).trim() === '')
  );
}
