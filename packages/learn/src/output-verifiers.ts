import { issue, verifierResult } from './verifier-result.js';
import type { Verifier } from './verifier-types.js';

export function minimumOutputVerifier(options: { id?: string; minLength?: number } = {}): Verifier {
  const id = options.id ?? 'minimum-output';
  const minLength = options.minLength ?? 1;
  return {
    id,
    verify(_example, rollout) {
      const passed = rollout.output.trim().length >= minLength;
      return verifierResult(
        id,
        passed,
        passed ? [] : [issue('output-too-short', 'warning', `output length is below ${minLength}`)],
        passed ? 1 : 0,
      );
    },
  };
}

export function outputContainsVerifier(
  options: { id?: string; contains?: string[]; caseSensitive?: boolean } = {},
): Verifier {
  const id = options.id ?? 'output-contains';
  const caseSensitive = options.caseSensitive ?? false;
  return {
    id,
    verify(example, rollout) {
      const expected = options.contains ?? example.expectedOutputContains ?? [];
      const output = caseSensitive ? rollout.output : rollout.output.toLowerCase();
      const missing = expected.filter((entry) => !output.includes(normalize(entry, caseSensitive)));
      return verifierResult(
        id,
        missing.length === 0,
        missing.map((entry) =>
          issue('missing-output-fragment', 'error', `output did not contain ${entry}`, { entry }),
        ),
        expected.length === 0 ? 1 : (expected.length - missing.length) / expected.length,
      );
    },
  };
}

function normalize(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}
