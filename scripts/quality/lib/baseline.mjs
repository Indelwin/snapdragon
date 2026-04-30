export const maintainabilityBaselinePath = '.quality/maintainability-baseline.json';
export const legacyCrapBaselinePath = '.quality/crap-baseline.json';

export function normalizeMaintainabilityBaseline(input) {
  return Object.fromEntries(
    Object.entries(input).map(([file, metrics]) => [
      file,
      {
        lines: metrics.lines,
        complexity: metrics.complexity,
        separationProxy: metrics.separationProxy ?? metrics.crapProxy,
        maxFunctionLines: metrics.maxFunctionLines,
      },
    ]),
  );
}

export function selectBaselineContent(entries) {
  const found = entries.find((entry) => entry.raw !== undefined);
  if (!found) return undefined;
  return {
    path: found.path,
    baseline: normalizeMaintainabilityBaseline(JSON.parse(found.raw)),
  };
}
