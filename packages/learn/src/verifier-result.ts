import type { VerifierIssue, VerifierResult, VerifierSeverity } from './verifier-types.js';

export function verifierResult(
  verifierId: string,
  passed: boolean,
  issues: VerifierIssue[],
  score?: number,
): VerifierResult {
  return { verifierId, passed, issues, score };
}

export function issue(
  id: string,
  severity: VerifierSeverity,
  message: string,
  metadata?: Record<string, unknown>,
): VerifierIssue {
  return { id, severity, message, metadata };
}
