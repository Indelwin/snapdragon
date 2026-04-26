#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { discoverFiles } from './lib/files.mjs';

const root = process.cwd();
const baselinePath = join(root, '.quality', 'crap-baseline.json');
const writeBaseline = process.argv.includes('--write-baseline');
const sourceFiles = await discoverFiles(
  root,
  (file) =>
    /\.(ts|tsx|js|jsx|rs)$/.test(file) &&
    !file.includes('/test/') &&
    !file.includes('/tests/') &&
    !file.includes('/features/') &&
    !file.endsWith('.test.ts') &&
    !file.endsWith('.test.tsx'),
);

const limits = {
  maxFileLines: 260,
  maxFunctionLines: 90,
  maxComplexity: 14,
  maxCrapProxy: 42,
};

const baseline = writeBaseline ? {} : await readBaseline();
const failures = [];
const nextBaseline = {};
for (const file of sourceFiles) {
  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const rel = relative(root, file);
  const fileComplexity = complexity(text);
  const exportedSymbols = countMatches(text, /\bexport\b/g);
  const crapProxy = fileComplexity * fileComplexity + exportedSymbols;
  const maxFunctionLines = Math.max(0, ...functionSpans(lines).map((fn) => fn.lines));
  const metrics = {
    lines: lines.length,
    complexity: fileComplexity,
    crapProxy,
    maxFunctionLines,
  };
  const breaches = breached(metrics);

  if (breaches.length > 0) {
    nextBaseline[rel] = metrics;
  }

  if (writeBaseline) continue;

  const allowed = baseline[rel];
  if (breaches.length > 0 && !allowed) {
    for (const breach of breaches) failures.push(`${rel}: ${breach}`);
    continue;
  }

  if (allowed && worsened(metrics, allowed)) {
    failures.push(
      `${rel}: worsened past CRAP baseline (${renderMetrics(metrics)} > ${renderMetrics(allowed)})`,
    );
  }
}

if (writeBaseline) {
  await mkdir(dirname(baselinePath), { recursive: true });
  await writeFile(`${baselinePath}.tmp`, `${JSON.stringify(nextBaseline, null, 2)}\n`);
  await rename(`${baselinePath}.tmp`, baselinePath);
  console.log(`Wrote CRAP baseline for ${Object.keys(nextBaseline).length} files.`);
  process.exit(0);
}

if (failures.length > 0) {
  console.error('CRAP/separation analysis failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CRAP/separation analysis ok (${sourceFiles.length} files).`);

async function readBaseline() {
  try {
    return JSON.parse(await readFile(baselinePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

function breached(metrics) {
  const out = [];
  if (metrics.lines > limits.maxFileLines) {
    out.push(`${metrics.lines} lines exceeds ${limits.maxFileLines}`);
  }
  if (metrics.complexity > limits.maxComplexity) {
    out.push(`complexity ${metrics.complexity} exceeds ${limits.maxComplexity}`);
  }
  if (metrics.crapProxy > limits.maxCrapProxy) {
    out.push(`CRAP proxy ${metrics.crapProxy} exceeds ${limits.maxCrapProxy}`);
  }
  if (metrics.maxFunctionLines > limits.maxFunctionLines) {
    out.push(`largest function spans ${metrics.maxFunctionLines} lines`);
  }
  return out;
}

function worsened(metrics, allowed) {
  return (
    metrics.lines > allowed.lines ||
    metrics.complexity > allowed.complexity ||
    metrics.crapProxy > allowed.crapProxy ||
    metrics.maxFunctionLines > allowed.maxFunctionLines
  );
}

function renderMetrics(metrics) {
  return `lines=${metrics.lines}, complexity=${metrics.complexity}, crap=${metrics.crapProxy}, fn=${metrics.maxFunctionLines}`;
}

function complexity(text) {
  const stripped = stripComments(text);
  return (
    1 +
    countMatches(stripped, /\b(if|else if|for|while|case|catch|match)\b/g) +
    countMatches(stripped, /&&|\|\||\?/g)
  );
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function functionSpans(lines) {
  const spans = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/\b(function|async function|fn)\b|=>/.test(line)) continue;
    const start = i;
    let depth = 0;
    let seenBrace = false;
    for (let j = i; j < lines.length; j += 1) {
      for (const char of lines[j]) {
        if (char === '{') {
          depth += 1;
          seenBrace = true;
        } else if (char === '}') {
          depth -= 1;
        }
      }
      if (seenBrace && depth <= 0) {
        spans.push({ line: start + 1, lines: j - start + 1 });
        i = j;
        break;
      }
    }
  }
  return spans;
}
