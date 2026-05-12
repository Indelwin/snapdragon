import { minimumOutputVerifier, outputContainsVerifier } from './output-verifiers.js';
import {
  expectedToolCallsVerifier,
  forbiddenToolsVerifier,
  requiredToolsVerifier,
  requiredToolUseVerifier,
} from './tool-policy-verifiers.js';
import {
  maxToolCallsVerifier,
  noConsecutiveDuplicateToolsVerifier,
  nonEmptyToolOutputVerifier,
  noRepeatedFailedToolCallsVerifier,
  toolSuccessVerifier,
} from './tool-quality-verifiers.js';
import type { Verifier } from './verifier-types.js';

export interface AntiGamingVerifierOptions {
  includeOutputChecks?: boolean;
  minOutputLength?: number;
  minimumToolSuccessRate?: number;
}

export function createAntiGamingVerifiers(options: AntiGamingVerifierOptions = {}): Verifier[] {
  const verifiers = [
    requiredToolUseVerifier(),
    requiredToolsVerifier(),
    forbiddenToolsVerifier(),
    expectedToolCallsVerifier(),
    toolSuccessVerifier({ minimumSuccessRate: options.minimumToolSuccessRate }),
    maxToolCallsVerifier(),
    noConsecutiveDuplicateToolsVerifier(),
    noRepeatedFailedToolCallsVerifier(),
    nonEmptyToolOutputVerifier(),
  ];
  if (options.includeOutputChecks ?? true) {
    verifiers.push(minimumOutputVerifier({ minLength: options.minOutputLength ?? 1 }));
    verifiers.push(outputContainsVerifier());
  }
  return verifiers;
}
