import type { TaskExample } from './dataset.js';
import type { RolloutTrace } from './rollout.js';
import type {
  Verifier,
  VerifierAggregationMode,
  VerifierResult,
  VerifierSummary,
} from './verifier-types.js';

export async function evaluateVerifiers(
  verifiers: Verifier[],
  example: TaskExample,
  rollout: RolloutTrace,
  mode: VerifierAggregationMode = 'all',
): Promise<VerifierSummary> {
  const results = await Promise.all(
    verifiers.map((verifier) => runVerifier(verifier, example, rollout)),
  );
  return summarizeVerifierResults(results, mode);
}

export function summarizeVerifierResults(
  results: VerifierResult[],
  mode: VerifierAggregationMode = 'all',
): VerifierSummary {
  const passedCount = results.filter((result) => result.passed).length;
  const failedCount = results.length - passedCount;
  if (results.length === 0) return { passed: true, score: 1, passedCount, failedCount, results };
  if (mode === 'weighted') return weightedSummary(results, passedCount, failedCount);
  return {
    passed: failedCount === 0,
    score: passedCount / results.length,
    passedCount,
    failedCount,
    results,
  };
}

async function runVerifier(
  verifier: Verifier,
  example: TaskExample,
  rollout: RolloutTrace,
): Promise<VerifierResult> {
  const result = await verifier.verify(example, rollout);
  return { ...result, weight: result.weight ?? verifier.weight ?? 1 };
}

function weightedSummary(
  results: VerifierResult[],
  passedCount: number,
  failedCount: number,
): VerifierSummary {
  const totalWeight = results.reduce((sum, result) => sum + (result.weight ?? 1), 0);
  const score =
    totalWeight === 0
      ? 0
      : results.reduce((sum, result) => sum + resultScore(result) * (result.weight ?? 1), 0) /
        totalWeight;
  return { passed: failedCount === 0, score, passedCount, failedCount, results };
}

function resultScore(result: VerifierResult): number {
  return result.score ?? (result.passed ? 1 : 0);
}
