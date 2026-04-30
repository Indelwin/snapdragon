#!/usr/bin/env node
import { gitMaybe } from './lib/git.mjs';

const log = await gitMaybe([
  'log',
  '--name-only',
  '--pretty=format:--COMMIT--',
  '--',
  'packages',
  'scripts',
  'crates',
]);
const commits = parseCommits(log ?? '');
const churn = new Map();
const pairs = new Map();
const limit = reportLimit();

for (const files of commits) {
  for (const file of files) churn.set(file, (churn.get(file) ?? 0) + 1);
  for (const pair of filePairs(files)) pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
}

console.log(`Logical coupling report (${modeName()}, non-blocking):`);
for (const [pair, count] of top(pairs, limit)) console.log(`- ${count}x ${pair}`);
console.log('\nChurn report (top changed files):');
for (const [file, count] of top(churn, limit)) console.log(`- ${count}x ${file}`);

function parseCommits(log) {
  return log
    .split('--COMMIT--')
    .map((chunk) => [...new Set(chunk.split('\n').filter((line) => line.includes('.')))])
    .filter((files) => files.length > 0);
}

function filePairs(files) {
  const out = [];
  const sorted = [...files].sort();
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) out.push(`${sorted[i]} <-> ${sorted[j]}`);
  }
  return out;
}

function top(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function reportLimit() {
  if (process.argv.includes('--summary')) return 5;
  if (process.argv.includes('--verbose')) return 25;
  return 10;
}

function modeName() {
  if (process.argv.includes('--summary')) return 'summary';
  if (process.argv.includes('--verbose')) return 'verbose';
  return 'default';
}
