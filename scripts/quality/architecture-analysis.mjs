#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { discoverFiles } from './lib/files.mjs';
import { fileImports, packageName } from './lib/imports.mjs';
import { isAnalyzedJsSource, isPackageSource } from './lib/source.mjs';

const root = process.cwd();
const config = JSON.parse(await readFile('.quality/architecture.json', 'utf8'));
const baselinePath = '.quality/architecture-baseline.json';
const writeBaseline = process.argv.includes('--write-baseline');
const files = await discoverFiles(root, isAnalyzedJsSource);
const graph = new Map();
const failures = [];

for (const file of files) {
  const imports = await fileImports(file, root);
  graph.set(
    file,
    imports.filter((item) => !item.external).map((item) => item.target),
  );
  failures.push(...boundaryFailures(file, imports));
}

const cycleKeys = cycleComponents(graph).map((component) => componentKey(component));
if (writeBaseline) await writeCycleBaseline(cycleKeys);
const baseline = await readCycleBaseline();
for (const key of cycleKeys) if (!baseline.has(key)) failures.push(`new import cycle: ${key}`);

if (failures.length > 0) {
  console.error('Architecture analysis failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Architecture analysis ok (${files.length} files, ${cycleKeys.length} known cycle(s)).`,
);

function boundaryFailures(file, imports) {
  const out = [];
  for (const item of imports) {
    if (config.forbidDistImports && item.specifier.includes('/dist')) {
      out.push(`${relative(root, file)} imports dist path ${item.specifier}`);
    }
    if (violatesPackageSrcBoundary(file, item)) {
      out.push(`${relative(root, file)} imports another package source via ${item.specifier}`);
    }
  }
  return out;
}

function violatesPackageSrcBoundary(file, item) {
  if (!config.forbidRelativePackageSrcImports || item.external || !isPackageSource(file))
    return false;
  const target = resolve(item.target);
  if (!isPackageSource(target)) return false;
  return packageName(file) !== packageName(target);
}

function cycleComponents(graph) {
  return stronglyConnected(graph).filter(
    (component) => component.length > 1 || selfLoops(graph, component),
  );
}

function selfLoops(graph, component) {
  const [node] = component;
  return graph.get(node)?.includes(node) ?? false;
}

function componentKey(component) {
  return component
    .map((file) => relative(root, file))
    .sort()
    .join('|');
}

async function readCycleBaseline() {
  try {
    const raw = JSON.parse(await readFile(baselinePath, 'utf8'));
    return new Set(raw.cycles ?? []);
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    throw error;
  }
}

async function writeCycleBaseline(cycles) {
  await mkdir(dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify({ cycles: cycles.sort() }, null, 2)}\n`);
  console.log(`Wrote architecture cycle baseline for ${cycles.length} cycle(s).`);
  process.exit(0);
}

function stronglyConnected(graph) {
  const state = {
    index: 0,
    stack: [],
    indices: new Map(),
    low: new Map(),
    onStack: new Set(),
    out: [],
  };
  for (const node of graph.keys()) if (!state.indices.has(node)) connect(node, graph, state);
  return state.out;
}

function connect(node, graph, state) {
  state.indices.set(node, state.index);
  state.low.set(node, state.index);
  state.index += 1;
  state.stack.push(node);
  state.onStack.add(node);
  for (const next of graph.get(node) ?? []) visitEdge(node, next, graph, state);
  if (state.low.get(node) === state.indices.get(node)) state.out.push(popComponent(node, state));
}

function visitEdge(node, next, graph, state) {
  if (!graph.has(next)) return;
  if (!state.indices.has(next)) {
    connect(next, graph, state);
    state.low.set(node, Math.min(state.low.get(node), state.low.get(next)));
  } else if (state.onStack.has(next)) {
    state.low.set(node, Math.min(state.low.get(node), state.indices.get(next)));
  }
}

function popComponent(node, state) {
  const component = [];
  let current;
  do {
    current = state.stack.pop();
    state.onStack.delete(current);
    component.push(current);
  } while (current !== node);
  return component;
}
