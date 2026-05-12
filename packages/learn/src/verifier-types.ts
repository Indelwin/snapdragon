import type { TaskExample } from './dataset.js';
import type { RolloutTrace } from './rollout.js';

export type VerifierSeverity = 'info' | 'warning' | 'error';
export type VerifierAggregationMode = 'all' | 'weighted';

export interface VerifierIssue {
  id: string;
  severity: VerifierSeverity;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface VerifierResult {
  verifierId: string;
  passed: boolean;
  score?: number;
  weight?: number;
  issues: VerifierIssue[];
  metadata?: Record<string, unknown>;
}

export interface Verifier {
  id: string;
  weight?: number;
  verify(example: TaskExample, rollout: RolloutTrace): VerifierResult | Promise<VerifierResult>;
}

export interface VerifierSummary {
  passed: boolean;
  score: number;
  passedCount: number;
  failedCount: number;
  results: VerifierResult[];
}
