#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  legacyCrapBaselinePath,
  maintainabilityBaselinePath,
  selectBaselineContent,
} from './lib/baseline.mjs';
import { resolveBaseRef, showFile } from './lib/git.mjs';
import { worsenedMaintainability } from './lib/maintainability.mjs';

if (process.env.SNAPDRAGON_ALLOW_QUALITY_BASELINE_INCREASE === '1') {
  console.log('Maintainability baseline increase guard skipped by explicit env override.');
  process.exit(0);
}

const baseRef = await resolveBaseRef();
if (!baseRef) {
  fail(
    'Unable to resolve a git base ref for maintainability baseline comparison.',
    'Fetch the base branch or set QUALITY_BASE_REF to an explicit commit/ref.',
  );
}

const current = await readJsonFile(maintainabilityBaselinePath);
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
  const selected = selectBaselineContent([
    {
      path: maintainabilityBaselinePath,
      raw: await showFile(baseRef, maintainabilityBaselinePath),
    },
    {
      path: legacyCrapBaselinePath,
      raw: await showFile(baseRef, legacyCrapBaselinePath),
    },
  ]);
  if (!selected) {
    fail(
      `Unable to read a maintainability baseline from base ref ${baseRef}.`,
      `Checked ${maintainabilityBaselinePath} and ${legacyCrapBaselinePath}.`,
      'Fetch the base branch or set QUALITY_BASE_REF to an explicit commit/ref.',
    );
  }
  return selected.baseline;
}

function fail(...lines) {
  for (const line of lines) console.error(line);
  console.error('Prefer tests or refactor before changing baseline.');
  process.exit(1);
}
