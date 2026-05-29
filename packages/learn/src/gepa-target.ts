// GEPA optimisation target descriptor. A target is a single piece of text the
// optimiser is allowed to mutate (e.g. a tool description, a skill prompt, an
// instruction block). `validateTargetValue` enforces declared constraints so
// the optimiser can reject malformed proposals before paying for a rollout.

export interface GepaTarget {
  /** Stable id; used as the key in `GepaCandidate.components`. */
  id: string;
  /** Free-form kind tag (e.g. 'instruction', 'tool-description', 'skill'). */
  kind: string;
  /** Initial text. */
  current: string;
  /** Human-readable description used by the proposer prompt. */
  description?: string;
  /** Free-form constraints surfaced to the proposer. */
  constraints?: string;
  /** Other target ids this one depends on (informational only for now). */
  dependsOn?: readonly string[];
  /** Substrings the proposed text MUST preserve verbatim. */
  preserve?: readonly string[];
  /** Hard upper bound on text length. */
  maxLength?: number;
  /** Format hint (e.g. 'markdown', 'json', 'gherkin'). */
  format?: string;
  /** User validation hook. Returns `true` or an error message. */
  validate?: (value: string) => true | string;
}

export type ValidationFailure = string;

/**
 * Validate a proposed value against a target's declared constraints. Returns
 * `true` on success or an error message describing the first failure.
 */
export function validateTargetValue(target: GepaTarget, value: string): true | ValidationFailure {
  if (typeof value !== 'string') return 'value must be a string';
  if (value.length === 0) return 'value must be non-empty';
  if (target.maxLength != null && value.length > target.maxLength) {
    return `value exceeds maxLength ${target.maxLength}`;
  }
  const preservedMissing = findMissingPreserved(target.preserve, value);
  if (preservedMissing != null) return `value missing required token: ${preservedMissing}`;
  return target.validate ? target.validate(value) : true;
}

function findMissingPreserved(
  preserve: readonly string[] | undefined,
  value: string,
): string | undefined {
  if (!preserve) return undefined;
  for (const token of preserve) {
    if (!value.includes(token)) return token;
  }
  return undefined;
}
