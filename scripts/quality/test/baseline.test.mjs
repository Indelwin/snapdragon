import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMaintainabilityBaseline, selectBaselineContent } from '../lib/baseline.mjs';

test('maintainability baseline normalization accepts the legacy CRAP proxy field', () => {
  assert.deepEqual(
    normalizeMaintainabilityBaseline({
      'sample.ts': {
        lines: 10,
        complexity: 2,
        crapProxy: 3,
        maxFunctionLines: 4,
      },
    }),
    {
      'sample.ts': {
        lines: 10,
        complexity: 2,
        separationProxy: 3,
        maxFunctionLines: 4,
      },
    },
  );
});

test('baseline content selection prefers the maintainability baseline over legacy fallback', () => {
  const selected = selectBaselineContent([
    {
      path: '.quality/maintainability-baseline.json',
      raw: JSON.stringify({
        'current.ts': { lines: 1, complexity: 1, separationProxy: 1, maxFunctionLines: 1 },
      }),
    },
    {
      path: '.quality/crap-baseline.json',
      raw: JSON.stringify({
        'legacy.ts': { lines: 2, complexity: 2, crapProxy: 2, maxFunctionLines: 2 },
      }),
    },
  ]);

  assert.equal(selected.path, '.quality/maintainability-baseline.json');
  assert.deepEqual(Object.keys(selected.baseline), ['current.ts']);
});

test('baseline content selection reports no content when no baseline file is available', () => {
  assert.equal(
    selectBaselineContent([
      { path: '.quality/maintainability-baseline.json', raw: undefined },
      { path: '.quality/crap-baseline.json', raw: undefined },
    ]),
    undefined,
  );
});
