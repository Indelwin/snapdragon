#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { discoverFiles } from './lib/files.mjs';
import { gitMaybe } from './lib/git.mjs';
import { maintainabilityMetrics } from './lib/maintainability.mjs';
import { isAnalyzedSource } from './lib/source.mjs';

const root = process.cwd();
const churn = await churnCounts();
const rows = [];
const limit = reportLimit();

for (const file of await discoverFiles(root, isAnalyzedSource)) {
  const rel = relative(root, file);
  const metrics = maintainabilityMetrics(await readFile(file, 'utf8'));
  const score = metrics.complexity * 2 + metrics.lines / 30 + (churn.get(rel) ?? 0);
  rows.push({ rel, score, metrics, churn: churn.get(rel) ?? 0 });
}

console.log(`Quality risk report (${modeName()}, non-blocking):`);
for (const row of rows.sort((a, b) => b.score - a.score).slice(0, limit)) {
  console.log(
    `- ${row.rel} score=${row.score.toFixed(1)} churn=${row.churn} complexity=${row.metrics.complexity} lines=${row.metrics.lines}`,
  );
}

async function churnCounts() {
  const log = await gitMaybe([
    'log',
    '--name-only',
    '--pretty=format:',
    '--',
    'packages',
    'scripts',
    'crates',
  ]);
  const counts = new Map();
  for (const file of (log ?? '').split('\n').filter(Boolean))
    counts.set(file, (counts.get(file) ?? 0) + 1);
  return counts;
}

function reportLimit() {
  if (process.argv.includes('--summary')) return 5;
  if (process.argv.includes('--verbose')) return 25;
  return 15;
}

function modeName() {
  if (process.argv.includes('--summary')) return 'summary';
  if (process.argv.includes('--verbose')) return 'verbose';
  return 'default';
}
