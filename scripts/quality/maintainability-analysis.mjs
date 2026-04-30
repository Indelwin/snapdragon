#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { discoverFiles } from './lib/files.mjs';
import {
  breachedMaintainability,
  maintainabilityMetrics,
  renderMaintainability,
  worsenedMaintainability,
} from './lib/maintainability.mjs';
import { isAnalyzedSource } from './lib/source.mjs';

const root = process.cwd();
const baselinePath = join(root, '.quality', 'maintainability-baseline.json');
const writeBaseline = process.argv.includes('--write-baseline');
const baseline = await readBaseline();
const sourceFiles = await discoverFiles(root, isAnalyzedSource);
const failures = [];
const nextBaseline = {};

for (const file of sourceFiles) {
  const rel = relative(root, file);
  const text = await readFile(file, 'utf8');
  const metrics = maintainabilityMetrics(text);
  const breaches = breachedMaintainability(metrics);
  if (breaches.length > 0) nextBaseline[rel] = metrics;
  if (writeBaseline) continue;
  const allowed = baseline[rel];
  if (breaches.length > 0 && !allowed) {
    failures.push(...breaches.map((breach) => `${rel}: ${breach}`));
  } else if (allowed && worsenedMaintainability(metrics, allowed)) {
    failures.push(`${rel}: worsened past maintainability baseline`);
    failures.push(`  current ${renderMaintainability(metrics)}`);
    failures.push(`  allowed ${renderMaintainability(allowed)}`);
  }
}

if (writeBaseline) await writeBaselineFile(nextBaseline);
if (failures.length > 0) fail(failures);
console.log(`Maintainability analysis ok (${sourceFiles.length} files).`);

async function readBaseline() {
  try {
    return JSON.parse(await readFile(baselinePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeBaselineFile(nextBaseline) {
  assertBaselineIncreaseAllowed(baseline, nextBaseline);
  await mkdir(dirname(baselinePath), { recursive: true });
  await writeFile(`${baselinePath}.tmp`, `${JSON.stringify(nextBaseline, null, 2)}\n`);
  await rename(`${baselinePath}.tmp`, baselinePath);
  console.log(`Wrote maintainability baseline for ${Object.keys(nextBaseline).length} files.`);
  process.exit(0);
}

function assertBaselineIncreaseAllowed(previous, nextBaseline) {
  if (process.env.SNAPDRAGON_ALLOW_QUALITY_BASELINE_INCREASE === '1') return;
  const increases = Object.entries(nextBaseline).filter(([file, metrics]) =>
    worsenedMaintainability(metrics, previous[file]),
  );
  if (increases.length === 0) return;
  fail([
    'Refusing to increase maintainability baseline without explicit approval.',
    ...increases.map(([file]) => `- ${file}`),
    'Prefer tests or refactor before changing baseline.',
    'Set SNAPDRAGON_ALLOW_QUALITY_BASELINE_INCREASE=1 only after human approval.',
  ]);
}

function fail(lines) {
  console.error('Maintainability analysis failed:');
  for (const line of lines) console.error(line);
  process.exit(1);
}
