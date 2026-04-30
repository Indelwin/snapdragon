#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolveBaseRef, showFile } from './lib/git.mjs';
import { worsenedMaintainability } from './lib/maintainability.mjs';

const baselinePath = '.quality/maintainability-baseline.json';
const fallbackPath = '.quality/crap-baseline.json';

if (process.env.SNAPDRAGON_ALLOW_QUALITY_BASELINE_INCREASE === '1') {
  console.log('Maintainability baseline increase guard skipped by explicit env override.');
  process.exit(0);
}

const baseRef = await resolveBaseRef();
const current = await readJsonFile(baselinePath);
const previous = await readBaseBaseline(baseRef);
const increases = Object.entries(current).filter(([file, metrics]) =>
  worsenedMaintainability(metrics, previous[file]),
);

if (increases.length > 0) {
  console.error('Maintainability baseline increased:');
  for (const [file] of increases) console.error(`- ${file}`);
  console.error('Prefer tests or refactor before changing baseline.');
  console.error('Set SNAPDRAGON_ALLOW_QUALITY_BASELINE_INCREASE=1 only after human approval.');
  process.exit(1);
}

console.log(`Maintainability baseline guard ok (${Object.keys(current).length} entries).`);

async function readJsonFile(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function readBaseBaseline(baseRef) {
  if (!baseRef) return {};
  const raw = (await showFile(baseRef, baselinePath)) ?? (await showFile(baseRef, fallbackPath));
  return raw ? normalizeBaseline(JSON.parse(raw)) : {};
}

function normalizeBaseline(input) {
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
