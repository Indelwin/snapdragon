import type { ExpectedToolCall } from './dataset.js';
import { expectedToolCallMatches } from './object-match.js';
import { issue, verifierResult } from './verifier-result.js';
import type { Verifier } from './verifier-types.js';

export function requiredToolUseVerifier(options: { id?: string } = {}): Verifier {
  const id = options.id ?? 'required-tool-use';
  return {
    id,
    verify(example, rollout) {
      const passed = !example.requiresTools || rollout.toolCalls.length > 0;
      return verifierResult(
        id,
        passed,
        passed
          ? []
          : [
              issue(
                'missing-required-tool-use',
                'error',
                'example requires tools but rollout used none',
              ),
            ],
        passed ? 1 : 0,
      );
    },
  };
}

export function requiredToolsVerifier(options: { id?: string; tools?: string[] } = {}): Verifier {
  const id = options.id ?? 'required-tools';
  return {
    id,
    verify(example, rollout) {
      const requiredTools = options.tools ?? example.requiredTools ?? [];
      const used = new Set(rollout.toolCalls.map((call) => call.name));
      const missing = requiredTools.filter((tool) => !used.has(tool));
      return verifierResult(
        id,
        missing.length === 0,
        missing.map((tool) =>
          issue('missing-required-tool', 'error', `required tool ${tool} was not used`, { tool }),
        ),
        requiredTools.length === 0
          ? 1
          : (requiredTools.length - missing.length) / requiredTools.length,
      );
    },
  };
}

export function forbiddenToolsVerifier(options: { id?: string; tools?: string[] } = {}): Verifier {
  const id = options.id ?? 'forbidden-tools';
  return {
    id,
    verify(example, rollout) {
      const forbiddenTools = options.tools ?? example.forbiddenTools ?? [];
      const forbidden = new Set(forbiddenTools);
      const violations = rollout.toolCalls.filter((call) => forbidden.has(call.name));
      return verifierResult(
        id,
        violations.length === 0,
        violations.map((call) =>
          issue('forbidden-tool-used', 'error', `forbidden tool ${call.name} was used`, { call }),
        ),
        violations.length === 0 ? 1 : 0,
      );
    },
  };
}

export function expectedToolCallsVerifier(
  options: { id?: string; calls?: ExpectedToolCall[] } = {},
): Verifier {
  const id = options.id ?? 'expected-tool-calls';
  return {
    id,
    verify(example, rollout) {
      const expectedCalls = options.calls ?? example.expectedToolCalls ?? [];
      const missing = expectedCalls.filter(
        (expected) => !rollout.toolCalls.some((call) => expectedToolCallMatches(expected, call)),
      );
      return verifierResult(
        id,
        missing.length === 0,
        missing.map((expected) =>
          issue(
            'missing-expected-tool-call',
            'error',
            `expected tool call ${expected.name} was not observed`,
            {
              expected,
            },
          ),
        ),
        expectedCalls.length === 0
          ? 1
          : (expectedCalls.length - missing.length) / expectedCalls.length,
      );
    },
  };
}
