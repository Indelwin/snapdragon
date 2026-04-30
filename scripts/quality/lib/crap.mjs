export const CRAP_THRESHOLD = 30;

export function crapScore(complexity, coverageRatio) {
  const uncovered = 1 - clampCoverage(coverageRatio);
  return complexity ** 2 * uncovered ** 3 + complexity;
}

export function formatScore(score) {
  return score.toFixed(2);
}

function clampCoverage(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
