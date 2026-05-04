import assert from 'node:assert/strict';
import test from 'node:test';
import { functionCoverage } from '../lib/coverage.mjs';
import { crapScore } from '../lib/crap.mjs';
import { parseChangedLineRanges } from '../lib/diff.mjs';
import { maintainabilityMetrics, worsenedMaintainability } from '../lib/maintainability.mjs';
import { analyzeFunctions, changedFunction } from '../lib/ts-functions.mjs';

test('AST complexity ignores optional access and nullish fallback', () => {
  const [fn] = analyzeFunctions(
    'sample.ts',
    'export function read(input?: { name?: string }) { return input?.name ?? "x"; }',
  );
  assert.equal(fn.complexity, 1);
});

test('AST complexity counts branches and logical alternatives', () => {
  const [fn] = analyzeFunctions(
    'sample.ts',
    'function check(a: boolean, b: boolean) { if (a && b) return 1; return a ? 2 : 3; }',
  );
  assert.equal(fn.complexity, 4);
});

test('CRAP score falls as coverage rises', () => {
  assert.equal(crapScore(8, 1), 8);
  assert.equal(crapScore(8, 0), 72);
  assert.ok(crapScore(8, 0.75) < 10);
});

test('changed line ranges identify touched functions', () => {
  const ranges = parseChangedLineRanges('@@ -1,0 +4,2 @@\n+one\n+two');
  const [first, second] = analyzeFunctions(
    'sample.ts',
    'function a() {\n}\n\nfunction b() {\n  return 1;\n}\n',
  );
  assert.equal(changedFunction(first, ranges), false);
  assert.equal(changedFunction(second, ranges), true);
});

test('function coverage maps intersecting covered ranges and handles missing files', () => {
  const fn = { start: 10, end: 30 };
  const coverage = [
    {
      functionName: 'demo',
      ranges: [
        { startOffset: 10, endOffset: 30, count: 1 },
        { startOffset: 20, endOffset: 30, count: 0 },
      ],
    },
  ];
  assert.equal(functionCoverage(undefined, fn), 0);
  assert.equal(functionCoverage(coverage, fn), 0.5);
});

test('function coverage uses covered duplicate entries from test workers', () => {
  const fn = { name: 'demo', start: 10, end: 30 };
  const coverage = [
    {
      functionName: 'demo',
      ranges: [{ startOffset: 10, endOffset: 30, count: 0 }],
    },
    {
      functionName: 'demo',
      ranges: [{ startOffset: 10, endOffset: 30, count: 1 }],
    },
  ];
  assert.equal(functionCoverage(coverage, fn), 1);
});

test('maintainability baseline guard treats decreases as safe', () => {
  const previous = maintainabilityMetrics('function a() { if (x) return 1; return 0; }');
  const next = maintainabilityMetrics('function a() { return 1; }');
  assert.equal(worsenedMaintainability(next, previous), false);
  assert.equal(worsenedMaintainability(previous, next), true);
});
