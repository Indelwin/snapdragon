#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { functionCoverage, readCoverage } from './lib/coverage.mjs';
import { CRAP_THRESHOLD, crapScore, formatScore } from './lib/crap.mjs';
import { changedLineRanges } from './lib/diff.mjs';
import { changedFiles, resolveBaseRef } from './lib/git.mjs';
import { isAnalyzedJsSource } from './lib/source.mjs';
import { analyzeFunctions, changedFunction } from './lib/ts-functions.mjs';

const root = process.cwd();
const coverageDir = resolve(root, '.quality', 'coverage', 'raw');
const baseRef = await resolveBaseRef();
const coverage = await readCoverage(coverageDir);
const changed = (await changedFiles(baseRef)).filter(isAnalyzedJsSource);
const failures = [];
let checked = 0;

for (const file of changed) {
  const ranges = await changedLineRanges(baseRef, file);
  const text = await readFile(file, 'utf8');
  const functions = analyzeFunctions(file, text).filter((fn) => changedFunction(fn, ranges));
  checked += functions.length;
  for (const fn of functions) evaluateFunction(file, fn);
}

if (failures.length > 0) {
  console.error('Coverage-aware CRAP analysis failed:');
  for (const failure of failures) console.error(failure);
  console.error('Prefer tests or refactor before changing baseline.');
  process.exit(1);
}

console.log(`Coverage-aware CRAP analysis ok (${checked} changed function(s)).`);

function evaluateFunction(file, fn) {
  const ratio = functionCoverage(coverage.get(resolve(root, file)), fn);
  const score = crapScore(fn.complexity, ratio);
  if (score <= CRAP_THRESHOLD) return;
  failures.push(
    `- ${relative(root, file)}:${fn.startLine} ${fn.name} CRAP ${formatScore(score)} > ${CRAP_THRESHOLD} ` +
      `(complexity=${fn.complexity}, coverage=${Math.round(ratio * 100)}%)`,
  );
}
